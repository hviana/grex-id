import "server-only";

import { getDb, normalizeRecordId, rid } from "../connection.ts";
import type { User } from "@/src/contracts/user";
import type { VerificationRequest } from "@/src/contracts/verification-request";
import type {
  VerificationActorType,
  VerificationOwnerType,
} from "@/src/contracts/high-level/verification";

function isRecordId(value: string): boolean {
  return /^[^:\s]+:[^:\s]+$/.test(value);
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
    tenantIds: request.tenantIds
      ? (Array.isArray(request.tenantIds)
        ? request.tenantIds
        : [...request.tenantIds])
        .map((t) => normalizeRecordId(t) ?? t)
        .filter(Boolean)
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// User lookups
// ---------------------------------------------------------------------------

/**
 * Look up a user by a verified entity_channel value (§8.4).
 *
 * Returns the user with its profile + channels resolved. Ignores unverified
 * channels. Traverses `user.channelIds` (never `profile.*`).
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
    LET $chs = (SELECT VALUE id FROM entity_channel WHERE ${filter});
    SELECT * FROM user WHERE channelIds CONTAINSANY $chs
      LIMIT 1 FETCH profileId, channelIds;`;
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
    `LET $u   = (SELECT channelIds FROM user WHERE id = $userId);
     LET $ids = IF array::len($u) = 0 THEN [] ELSE $u[0].channelIds END;
     SELECT count() AS c FROM entity_channel
     WHERE id IN $ids AND verified = true
     GROUP ALL;`,
    { userId: rid(userId) },
  );
  const last = result[result.length - 1] as { c: number }[] | undefined;
  return (last?.[0]?.c ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// User creation
// ---------------------------------------------------------------------------

/**
 * Create a new user + profile + initial entity_channel rows in one batched
 * query (§2.4). The entity_channel rows are created first (composable rows
 * carry no back-pointer — §3.3), then the profile (with empty
 * recoveryChannelIds), then the user whose `channelIds` array references all
 * the created entity_channel rows. Channels are created unverified; caller
 * issues the human confirmation via communicationGuard +
 * dispatchCommunication(…).
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
    .join(", ") + (params.channels.length > 0 ? "," : "");

  const bindings: Record<string, unknown> = {
    name: params.name,
    password: params.password,
  };
  const profileSets = ["name = $name"];
  if (params.locale) {
    bindings.locale = params.locale;
    profileSets.push("locale = $locale");
  }
  params.channels.forEach((c, i) => {
    bindings[`type${i}`] = c.type;
    bindings[`value${i}`] = c.value;
  });

  const query = `
    ${channelStatements}
    LET $prof = CREATE profile SET
      ${profileSets.join(",\n      ")},
      recoveryChannelIds = <set>[];
    LET $rl = CREATE resource_limit SET
      roleIds = <set>[],
      benefits = <set>[];
    LET $usr  = CREATE user SET
      passwordHash = crypto::argon2::generate($password),
      profileId = $prof[0].id,
      resourceLimitId = $rl[0].id,
      channelIds = {${channelsArray}},
      twoFactorEnabled = false,
      stayLoggedIn = false;
    SELECT * FROM $usr[0].id FETCH profileId, channelIds;`;

  const result = await db.query<unknown[]>(query, bindings);
  const last = result[result.length - 1] as Array<
    { id: string; channelIds?: unknown }
  >;
  const user = last[0];
  const rawChannels = user?.channelIds;
  const channels: unknown[] = Array.isArray(rawChannels)
    ? rawChannels
    : rawChannels instanceof Set
    ? [...rawChannels]
    : [];
  return {
    user: user as unknown as User,
    channelIds: channels.map((c) => normalizeRecordId(c) ?? String(c)),
  };
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Verification requests
// ---------------------------------------------------------------------------

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
 *   - the user has no verified entity_channel in its `channelIds` array, AND
 *   - the user has no unused, non-expired verification_request with
 *     actionKey = "auth.action.register".
 *
 * Deletes every user in `userIds`, their referenced entity_channel rows,
 * their profile records, tenant rows, and all
 * verification_requests pointing at them — in a single batched query (§2.4).
 */
export async function purgeAbandonedUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = await getDb();
  const ids = userIds.map((id) => rid(id));
  await db.query(
    `LET $targets = $userIds;
     LET $users = (SELECT id, profileId, channelIds FROM user WHERE id IN $targets);
     LET $profileIds = $users.profileId;
     LET $channelIds = array::flatten($users.channelIds);
     LET $tenantIds = (SELECT VALUE id FROM tenant WHERE actorId IN $targets);
     DELETE verification_request WHERE ownerId IN $targets;
     DELETE tenant WHERE actorId IN $targets;
     DELETE user WHERE id IN $targets;
     DELETE entity_channel WHERE id IN $channelIds;
     DELETE profile WHERE id IN $profileIds;`,
    { userIds: ids },
  );
}

// ---------------------------------------------------------------------------
// Tenant & membership resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the first user-access tenant row for a user (actorId=user with a
 * companyId and systemId set), including the system slug and role names from
 * the user's resource_limit.roleIds. Returns null when the user has no memberships.
 *
 * Used by login and login-fallback flows (§8.4, §8.8).
 */
export async function resolveUserMembership(userId: string): Promise<
  {
    tenantId: string;
    companyId: string;
    systemId: string;
    systemSlug: string;
    roles: string[];
  } | null
> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $t = (SELECT id, companyId, systemId FROM tenant
       WHERE actorId = $userId
         AND companyId
         AND systemId
       LIMIT 1);
     LET $sys = IF array::len($t) > 0
       THEN (SELECT slug FROM system WHERE id = $t[0].systemId LIMIT 1)
       ELSE [] END;
     LET $roleIds = IF array::len($t) > 0
       THEN (SELECT VALUE resourceLimitId.roleIds FROM user WHERE id = $userId LIMIT 1)[0]
       ELSE [] END;
     LET $roleNames = (SELECT VALUE name FROM role WHERE id IN $roleIds);
     [{ tenantId: $t[0].id, companyId: $t[0].companyId, systemId: $t[0].systemId,
        systemSlug: $sys[0].slug, roles: $roleNames }];`,
    { userId: rid(userId) },
  );
  const last = result[result.length - 1] as Record<string, unknown>[];
  const row = last?.[0] as Record<string, unknown> | undefined;
  if (!row || !row.tenantId) return null;
  return {
    tenantId: String(row.tenantId),
    companyId: String(row.companyId),
    systemId: String(row.systemId),
    systemSlug: (row.systemSlug as string) ?? "core",
    roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
  };
}

/**
 * Verify the company-system tenant row exists and resolve system slug for
 * superuser exchange bypass (§8.6). Looks up the tenant row where
 * actorId=NONE, companyId=$companyId, systemId=$systemId.
 */
export async function resolveSuperuserExchange(
  companyId: string,
  systemId: string,
): Promise<{ exists: boolean; slug: string; tenantId: string | null }> {
  const db = await getDb();
  const result = await db.query<
    [null, null, { id: string }[], { slug: string }[]]
  >(
    `LET $existing = (SELECT id FROM tenant
       WHERE !actorId
         AND companyId = $companyId
         AND systemId = $systemId
       LIMIT 1);
     IF array::len($existing) = 0 {
       CREATE tenant SET
         actorId = NONE,
         companyId = $companyId,
         systemId = $systemId,
         isOwner = false;
     };
     SELECT id FROM tenant
       WHERE !actorId
         AND companyId = $companyId
         AND systemId = $systemId
       LIMIT 1;
     SELECT slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
  const tenantRow = result[2]?.[0];
  return {
    exists: !!tenantRow,
    slug: result[3]?.[0]?.slug ?? "core",
    tenantId: tenantRow ? String(tenantRow.id) : null,
  };
}

/**
 * Verify user membership in a (company, system) tenant and resolve slug +
 * role names from the user's resource_limit.roleIds. Used by the token exchange flow (§8.6).
 *
 * Finds the tenant row where actorId=$userId, companyId=$companyId,
 * systemId=$systemId, then resolves roles via resource_limit.roleIds.
 */
export async function resolveUserExchange(
  userId: string,
  companyId: string,
  systemId: string,
): Promise<{
  tenantId: string | null;
  roles: string[];
  slug: string;
}> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $t = (SELECT id FROM tenant
       WHERE actorId = $userId
         AND companyId = $companyId
         AND systemId = $systemId
       LIMIT 1);
     LET $sys = (SELECT slug FROM system WHERE id = $systemId LIMIT 1);
     LET $roleIds = IF array::len($t) > 0
       THEN (SELECT VALUE resourceLimitId.roleIds FROM user WHERE id = $userId LIMIT 1)[0]
       ELSE [] END;
     LET $roleNames = (SELECT VALUE name FROM role WHERE id IN $roleIds);
     [{ tenantId: $t[0].id, slug: $sys[0].slug, roles: $roleNames }];`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
  const last = result[result.length - 1] as Record<string, unknown>[];
  const row = last?.[0] as Record<string, unknown> | undefined;
  return {
    tenantId: row?.tenantId ? String(row.tenantId) : null,
    roles: Array.isArray(row?.roles) ? (row.roles as string[]) : [],
    slug: (row?.slug as string) ?? "core",
  };
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

/**
 * Promote the user's pendingTwoFactorSecret to twoFactorSecret and enable 2FA
 * (§8.8). The secret stays on the user row — it never travels through
 * verification_request.payload.
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
 * Disable two-factor authentication for a user (§8.8).
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
 * Store an AES-256-GCM envelope as the user's pendingTwoFactorSecret.
 * The plaintext base32 secret never touches the DB (§4.7).
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
