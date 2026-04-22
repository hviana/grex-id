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
 * Look up a user by a verified entity_channel value (§19.5).
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
    LET $ch   = (SELECT id FROM entity_channel WHERE ${filter} LIMIT 1)[0];
    LET $chId = IF $ch = NONE THEN NONE ELSE $ch.id END;
    IF $chId = NONE
      THEN []
      ELSE (SELECT * FROM user WHERE channels CONTAINS $chId LIMIT 1
              FETCH profile, channels)
    END;`;
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
    `LET $u   = (SELECT channels FROM user WHERE id = $userId)[0];
     LET $ids = IF $u = NONE THEN [] ELSE $u.channels END;
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
  const db = await getDb();
  const result = await db.query<[{ valid: boolean }[]]>(
    `SELECT crypto::argon2::compare(passwordHash, $password) AS valid
     FROM user WHERE id = $id LIMIT 1`,
    { id: rid(userId), password },
  );
  return result[0]?.[0]?.valid === true;
}

/**
 * Create a new user + profile + initial entity_channel rows in one batched
 * query (§7.2). The entity_channel rows are created first (composable rows
 * carry no back-pointer — §1.1.10), then the profile (with empty
 * recovery_channels), then the user whose `channels` array references all
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
      recovery_channels = [];
    LET $usr  = CREATE user SET
      passwordHash = crypto::argon2::generate($password),
      profile = $prof[0].id,
      channels = [${channelsArray}],
      roles = ["viewer"],
      twoFactorEnabled = false,
      stayLoggedIn = false;
    SELECT * FROM $usr[0].id FETCH profile, channels;`;

  const result = await db.query<unknown[]>(query, bindings);
  const last = result[result.length - 1] as User[];
  const user = last[0];
  const channels = (user?.channels ?? []) as { id: string }[];
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
 * channel values (§19.4). "Abandoned" means:
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
     LET $users = (SELECT id, profile, channels FROM user WHERE id IN $targets);
     LET $profileIds = array::distinct($users.profile);
     LET $channelIds = array::distinct(array::flatten($users.channels));
     DELETE verification_request WHERE ownerId IN $targets;
     DELETE user WHERE id IN $targets;
     FOR $cid IN $channelIds { DELETE $cid; };
     FOR $pid IN $profileIds { DELETE $pid; };`,
    { userIds: ids },
  );
}
