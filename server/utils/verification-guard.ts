import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken } from "@/server/utils/token";
import type { VerificationRequestType } from "@/server/db/queries/auth";
import Core from "@/server/utils/Core";

if (typeof window !== "undefined") {
  throw new Error(
    "verification-guard.ts must not be imported in client-side code.",
  );
}

export interface CommunicationGuardResult {
  allowed: boolean;
  reason?: "previousNotExpired" | "rateLimited";
  token?: string;
  expiresAt?: Date;
}

export async function communicationGuard(params: {
  userId: string;
  type: VerificationRequestType;
  payload?: Record<string, unknown>;
  systemSlug?: string;
}): Promise<CommunicationGuardResult> {
  const core = Core.getInstance();
  const { userId, type, payload, systemSlug } = params;

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const maxCount = Number(
    (await core.getSetting("auth.communication.maxCount", systemSlug)) || 5,
  );
  const windowHours = Number(
    (await core.getSetting("auth.communication.windowHours", systemSlug)) || 1,
  );

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
  const windowStart = new Date(Date.now() - windowHours * 3_600_000);

  const db = await getDb();
  const normalizedUserId = String(userId);

  const result = await db.query<
    [
      { id: string }[],
      { cnt: number }[],
      unknown[],
      {
        blockedByPrevious: boolean;
        blockedByRateLimit: boolean;
        allowed: boolean;
      }[],
    ]
  >(
    `LET $lastActive = (
      SELECT id, createdAt FROM verification_request
      WHERE userId = $userId
        AND type = $type
        AND usedAt IS NONE
        AND expiresAt > time::now()
      ORDER BY createdAt DESC
      LIMIT 1
    );

    LET $windowCount = (
      SELECT count() AS cnt FROM verification_request
      WHERE userId = $userId
        AND type = $type
        AND createdAt > $windowStart
      GROUP ALL
    );

    LET $wCnt = IF array::len($windowCount) > 0
      THEN $windowCount[0].cnt
      ELSE 0
    END;

    LET $created = IF array::len($lastActive) = 0 AND $wCnt < $maxCount
    THEN (
      CREATE verification_request SET
        userId = $userId,
        type = $type,
        token = $verificationToken,
        expiresAt = $expiresAt,
        payload = $payload
    ) ELSE [] END;

    [{
      blockedByPrevious: array::len($lastActive) > 0,
      blockedByRateLimit: $wCnt >= $maxCount,
      allowed: array::len($created) > 0
    }];`,
    {
      userId: rid(normalizedUserId),
      type,
      verificationToken: token,
      expiresAt,
      payload: payload ?? undefined,
      windowStart,
      maxCount,
    },
  );

  const status = result[3]?.[0];

  if (!status) {
    return { allowed: false };
  }

  if (status.blockedByPrevious) {
    return { allowed: false, reason: "previousNotExpired" };
  }

  if (status.blockedByRateLimit) {
    return { allowed: false, reason: "rateLimited" };
  }

  if (!status.allowed) {
    return { allowed: false };
  }

  return { allowed: true, token, expiresAt };
}
