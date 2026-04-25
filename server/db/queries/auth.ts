import { getDb, rid } from "../connection.ts";
import type { User } from "@/src/contracts/user";
import type {
  VerificationActorType,
  VerificationOwnerType,
  VerificationRequest,
} from "@/src/contracts/verification-request";

export type {
  VerificationActorType,
  VerificationOwnerType,
} from "@/src/contracts/verification-request";
import { assertServerOnly } from "../../utils/server-only.ts";
import { genericVerify } from "./generics.ts";

assertServerOnly("auth");

export type VerificationRequestRecord = VerificationRequest;

function isRecordId(value: string): boolean {
  return /^[^:\s]+:[^:\s]+$/.test(value);
}

function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();
  if (isRecordId(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string" && typeof record.id === "string") {
      return `${record.tb}:${record.id}`;
    }
    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }
  }

  return stringified || null;
}

function requireRecordId(value: unknown, field: string): string {
  const id = normalizeRecordId(value);
  if (!id || !isRecordId(id)) {
    throw new Error(`INVALID_RECORD_ID:${field}`);
  }
  return id;
}

function normalizeVerificationRequest(
  request: VerificationRequest | null,
): VerificationRequest | null {
  if (!request) return request;

  return {
    ...request,
    id: normalizeRecordId(request.id) ?? request.id,
    ownerId: normalizeRecordId(request.ownerId) ?? request.ownerId,
    companyId: normalizeRecordId(request.companyId) ?? request.companyId,
    systemId: normalizeRecordId(request.systemId) ?? request.systemId,
  };
}

/**
 * Look up a user by a verified entity_channel value (§8.4).
 *
 * Returns the user with its profile + channels resolved. Ignores unverified
 * channels. Traverses `user.channels` (never `profile.*`).
 */
export async function findUserByVerifiedChannel(
  value: string,
  channelType?: string,
): Promise<User | null> {
  const db = await getDb();
  const filter = channelType
    ? `type = $type AND value = $value AND verified = true`
    : `value = $value AND verified = true`;
  const query = `
    LET $ch = (SELECT id FROM entity_channel WHERE ${filter} LIMIT 1)[0];
    SELECT * FROM user WHERE channelIds CONTAINS $ch.id LIMIT 1
      FETCH profileId, channelIds;`;
  const result = await db.query<unknown[]>(query, {
    value,
    type: channelType ?? undefined,
  });
  const last = result[result.length - 1] as User[] | undefined;
  return last?.[0] ?? null;
}

export async function userHasVerifiedChannel(userId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $u   = (SELECT channelIds FROM user WHERE id = $userId)[0];
     LET $ids = IF $u = NONE THEN [] ELSE $u.channelIds END;
     SELECT count() AS c FROM entity_channel
     WHERE id IN $ids AND verified = true
     GROUP ALL;`,
    { userId: rid(userId) },
  );
  const last = result[result.length - 1] as { c: number }[] | undefined;
  return (last?.[0]?.c ?? 0) > 0;
}

export async function verifyPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  return genericVerify(
    { table: "user", hashField: "passwordHash" },
    userId,
    password,
  );
}

/**
 * Create a new user + profile + initial entity_channel rows in one batched
 * query (§7.2). The entity_channel rows are created first (composable rows
 * carry no back-pointer — §3.1.10), then the profile (with empty
 * recoveryChannelIds), then the user whose `channels` array references all
 * the created entity_channel rows. Channels are created unverified; caller
 * issues the human confirmation via communicationGuard +
 * publish("send_communication", …).
 */
export async function createUserWithChannels(params: {
  password: string;
  name: string;
  locale?: string;
  channels: { type: string; value: string }[];
}): Promise<{ user: User; channelIds: string[] }> {
  const db = await getDb();

  const channelStatements = params.channels
    .map(
      (_, i) => `
      LET $ch${i} = CREATE entity_channel SET
        type = $type${i},
        value = $value${i},
        verified = false;`,
    )
    .join("");

  const channelsArray = params.channels
    .map((_, i) => `$ch${i}[0].id`)
    .join(", ");

  const bindings: Record<string, unknown> = {
    name: params.name,
    locale: params.locale ?? undefined,
    password: params.password,
  };
  params.channels.forEach((c, i) => {
    bindings[`type${i}`] = c.type;
    bindings[`value${i}`] = c.value;
  });

  const query = `
    ${channelStatements}
    LET $prof = CREATE profile SET
      name = $name,
      locale = $locale,
      recoveryChannelIds = [];
    LET $usr  = CREATE user SET
      passwordHash = crypto::argon2::generate($password),
      profileId = $prof[0].id,
      channelIds = [${channelsArray}],
      roles = [],
      twoFactorEnabled = false,
      stayLoggedIn = false;
    SELECT * FROM $usr[0].id FETCH profileId, channelIds;`;

  const result = await db.query<unknown[]>(query, bindings);
  const last = result[result.length - 1] as User[];
  const user = last[0];
  const channels = (user?.channelIds ?? []) as { id: string }[];
  return {
    user,
    channelIds: channels.map((c) => String(c.id)),
  };
}

export async function updatePassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const db = await getDb();
  const normalizedUserId = requireRecordId(userId, "userId");
  await db.query(
    "UPDATE $userId SET passwordHash = crypto::argon2::generate($password), updatedAt = time::now()",
    { userId: rid(normalizedUserId), password: newPassword },
  );
}

/**
 * Computes an argon2 hash for a plaintext password inside SurrealDB, so that
 * route handlers never have to pass the plaintext to subsequent queries (e.g.
 * when the hash must be stored in a verification_request payload).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const db = await getDb();
  const result = await db.query<[string | string[]]>(
    "RETURN crypto::argon2::generate($password);",
    { password: plaintext },
  );
  const value = result[0];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

/**
 * Sets a precomputed argon2 hash as the user's password in one batched query.
 * Used by the verify handler to apply a password-change confirmation without
 * ever touching plaintext.
 */
export async function applyPasswordHash(
  userId: string,
  passwordHash: string,
): Promise<void> {
  const db = await getDb();
  const normalizedUserId = requireRecordId(userId, "userId");
  await db.query(
    "UPDATE $userId SET passwordHash = $hash, updatedAt = time::now()",
    { userId: rid(normalizedUserId), hash: passwordHash },
  );
}

export async function findVerificationRequest(
  token: string,
): Promise<VerificationRequest | null> {
  const db = await getDb();
  const result = await db.query<[VerificationRequest[]]>(
    "SELECT * FROM verification_request WHERE token = $verificationToken LIMIT 1",
    { verificationToken: token },
  );
  return normalizeVerificationRequest(result[0]?.[0] ?? null);
}

export async function markVerificationUsed(requestId: string): Promise<void> {
  const db = await getDb();
  const normalizedRequestId = requireRecordId(requestId, "requestId");
  await db.query(
    "UPDATE $requestId SET usedAt = time::now()",
    { requestId: rid(normalizedRequestId) },
  );
}

/**
 * Hard-delete abandoned user accounts before registration reuses their
 * channel values (§8.3). "Abandoned" means:
 *   - the user has no verified entity_channel in its `channels` array, AND
 *   - the user has no unused, non-expired verification_request with
 *     actionKey = "auth.action.register".
 *
 * Deletes every user in `userIds`, their referenced entity_channel rows,
 * their profile records, and all verification_requests pointing at them —
 * in a single batched query (§7.2).
 */
export async function purgeAbandonedUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = await getDb();
  const ids = userIds.map((id) => rid(id));
  await db.query(
    `LET $targets = $userIds;
     LET $users = (SELECT id, profileId, channelIds FROM user WHERE id IN $targets);
     LET $profileIds = array::distinct($users.profileId);
     LET $channelIds = array::distinct(array::flatten($users.channelIds));
     DELETE verification_request WHERE ownerId IN $targets;
     DELETE user WHERE id IN $targets;
     FOR $cid IN $channelIds { DELETE $cid; };
     FOR $pid IN $profileIds { DELETE $pid; };`,
    { userIds: ids },
  );
}

/**
 * Resolve the first user_company_system membership for a user, including the
 * system slug and flattened role permissions. Returns null when the user has
 * no memberships (e.g. superuser without tenant).
 *
 * Used by login and login-fallback flows (§8.4, §8.8.3).
 */
export async function resolveUserMembership(userId: string): Promise<
  {
    companyId: string;
    systemId: string;
    systemSlug: string;
    roles: string[];
    permissions: string[];
  } | null
> {
  const db = await getDb();
  const membership = await db.query<
    [{
      companyId: string;
      systemId: string;
      systemSlug: string;
      roles: string[];
      permissions: string[];
    }[]]
  >(
    `LET $ucs = (SELECT companyId, systemId FROM user_company_system WHERE userId = $userId LIMIT 1);
     IF array::len($ucs) > 0 {
       LET $sys = (SELECT slug FROM system WHERE id = $ucs[0].systemId LIMIT 1);
       LET $roleRecs = (SELECT permissions FROM role WHERE systemId = $ucs[0].systemId AND id IN (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles);
       SELECT
         $ucs[0].companyId AS companyId,
         $ucs[0].systemId AS systemId,
         $sys[0].slug AS systemSlug,
         (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles AS roles,
         array::flatten($roleRecs[*].permissions) AS permissions
       FROM system WHERE id = $ucs[0].systemId LIMIT 1;
     } ELSE {
       RETURN [];
     };`,
    { userId: rid(userId) },
  );
  return membership[0]?.[0] ?? null;
}

/**
 * Verify company_system association exists and resolve system slug for
 * superuser exchange bypass (§8.6).
 */
export async function resolveSuperuserExchange(
  companyId: string,
  systemId: string,
): Promise<{ exists: boolean; slug: string }> {
  const db = await getDb();
  const result = await db.query<
    [{ id: string }[], { slug: string }[]]
  >(
    `SELECT id FROM company_system
       WHERE companyId = $companyId AND systemId = $systemId LIMIT 1;
     SELECT slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
  return {
    exists: result[0] != null && result[0].length > 0,
    slug: result[1]?.[0]?.slug ?? "core",
  };
}

/**
 * Verify user membership in a (company, system) and resolve slug + flattened
 * role permissions. Used by the token exchange flow (§8.6).
 */
export async function resolveUserExchange(
  userId: string,
  companyId: string,
  systemId: string,
): Promise<{
  membership: { id: string; roles: string[] } | null;
  slug: string;
  permissions: string[];
}> {
  const db = await getDb();
  const result = await db.query<
    [
      { id: string; roles: string[] }[],
      { slug: string }[],
      { permissions: string[] }[],
    ]
  >(
    `SELECT id, roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
       LIMIT 1;
     SELECT slug FROM system WHERE id = $systemId LIMIT 1;
     SELECT permissions FROM role WHERE name IN array::flatten(SELECT VALUE roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId LIMIT 1)
       AND systemId = $systemId;`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
  const mem = result[0]?.[0] ?? null;
  const permissions = [
    ...new Set(result[2]?.flatMap((r) => r.permissions ?? []) ?? []),
  ];
  return {
    membership: mem ? { id: String(mem.id), roles: mem.roles ?? [] } : null,
    slug: result[1]?.[0]?.slug ?? "core",
    permissions,
  };
}

/**
 * Promote the user's pendingTwoFactorSecret to twoFactorSecret and enable 2FA
 * (§8.8.2). The secret stays on the user row — it never travels through
 * verification_request.payload (§5.1 rule 5).
 */
export async function promoteTwoFactorSecret(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $u = (SELECT pendingTwoFactorSecret FROM $userId LIMIT 1);
     IF array::len($u) > 0 AND $u[0].pendingTwoFactorSecret != NONE {
       UPDATE $userId SET
         twoFactorEnabled = true,
         twoFactorSecret = $u[0].pendingTwoFactorSecret,
         pendingTwoFactorSecret = NONE,
         updatedAt = time::now();
     };`,
    { userId: rid(userId) },
  );
}

/**
 * Disable two-factor authentication for a user (§8.8.2).
 * Clears the secret and the pending secret in one batched update.
 */
export async function disableTwoFactor(userId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $userId SET
      twoFactorEnabled = false,
      twoFactorSecret = NONE,
      pendingTwoFactorSecret = NONE,
      updatedAt = time::now()`,
    { userId: rid(userId) },
  );
}

/**
 * Fetch a user row with profile and channels resolved. Used by routes that
 * need the user's profile (name, locale) or channel values for communication
 * dispatch.
 */
export async function getUserWithProfile(userId: string): Promise<
  {
    profileId: { name: string; locale?: string };
    channelIds: { value: string }[];
  } | null
> {
  const db = await getDb();
  const result = await db.query<
    [{
      profileId: { name: string; locale?: string };
      channelIds: { value: string }[];
    }[]]
  >(
    `SELECT * FROM $userId LIMIT 1 FETCH profileId, channelIds`,
    { userId: rid(userId) },
  );
  return result[0]?.[0] ?? null;
}

/**
 * Get only the profile fields (name, locale) for a user. Used by routes that
 * only need the profile for communication template data.
 */
export async function getUserProfile(userId: string): Promise<
  {
    name: string;
    locale?: string;
  } | null
> {
  const db = await getDb();
  const result = await db.query<
    [{ profileId: { name: string; locale?: string } }[]]
  >(
    `SELECT profileId FROM $userId FETCH profileId`,
    { userId: rid(userId) },
  );
  const profile = result[0]?.[0]?.profileId;
  return profile ?? null;
}

/**
 * Store an AES-256-GCM envelope as the user's pendingTwoFactorSecret.
 * The plaintext base32 secret never touches the DB (§7.1.1, §12.15).
 */
export async function storePendingTwoFactorSecret(
  userId: string,
  encrypted: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $userId SET pendingTwoFactorSecret = $secret, updatedAt = time::now()`,
    { userId: rid(userId), secret: encrypted },
  );
}

/**
 * Fetch user fields needed by the refresh-token flow: stayLoggedIn, roles,
 * twoFactorEnabled, profile, and channels — all in a single batched query
 * with FETCH resolution (§7.2).
 */
export async function getUserForRefresh(userId: string): Promise<
  {
    id: string;
    stayLoggedIn: boolean;
    roles: string[];
    twoFactorEnabled: boolean;
    profileId?: unknown;
    channelIds?: unknown[];
  } | null
> {
  const db = await getDb();
  const result = await db.query<
    [{
      id: string;
      stayLoggedIn: boolean;
      roles: string[];
      twoFactorEnabled: boolean;
      profileId?: unknown;
      channelIds?: unknown[];
    }[]]
  >(
    `SELECT id, stayLoggedIn, roles, twoFactorEnabled, profileId, channelIds
       FROM $userId LIMIT 1
       FETCH profileId, channelIds;`,
    { userId: rid(userId) },
  );
  return result[0]?.[0] ?? null;
}

/**
 * Look up a system id by its slug. Returns the system id string or null.
 */
export async function findSystemIdBySlug(slug: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug },
  );
  return result[0]?.[0]?.id ?? null;
}
