import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import type {
  VerificationOwnerType,
  VerificationRequestTenantContext,
} from "@/src/contracts/verification-request";

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
  ownerId: string;
  ownerType: VerificationOwnerType;
  actionKey: string;
  payload?: Record<string, unknown>;
  tenant?: VerificationRequestTenantContext;
}): Promise<CommunicationGuardResult> {
  const core = Core.getInstance();
  const { ownerId, ownerType, actionKey, payload, tenant } = params;
  const systemSlug = tenant?.systemSlug;

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

  type GuardStatus = {
    blockedByPrevious: boolean;
    blockedByRateLimit: boolean;
    allowed: boolean;
  };

  const result = await db.query<unknown[]>(
    `LET $lastActive = (
      SELECT id, createdAt FROM verification_request
      WHERE ownerId = $ownerId
        AND actionKey = $actionKey
        AND usedAt IS NONE
        AND expiresAt > time::now()
      ORDER BY createdAt DESC
      LIMIT 1
    );

    LET $windowCount = (
      SELECT count() AS cnt FROM verification_request
      WHERE ownerId = $ownerId
        AND actionKey = $actionKey
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
        ownerId = $ownerId,
        ownerType = $ownerType,
        actionKey = $actionKey,
        token = $verificationToken,
        expiresAt = $expiresAt,
        payload = $payload,
        companyId = $companyId,
        systemId = $systemId,
        systemSlug = $systemSlug,
        actorId = $actorId,
        actorType = $actorType
    ) ELSE [] END;

    [{
      blockedByPrevious: array::len($lastActive) > 0,
      blockedByRateLimit: $wCnt >= $maxCount,
      allowed: array::len($created) > 0
    }];`,
    {
      ownerId: rid(String(ownerId)),
      ownerType,
      actionKey,
      verificationToken: token,
      expiresAt,
      payload: payload ?? undefined,
      windowStart,
      maxCount,
      companyId: tenant?.companyId ? rid(tenant.companyId) : undefined,
      systemId: tenant?.systemId ? rid(tenant.systemId) : undefined,
      systemSlug: tenant?.systemSlug ?? undefined,
      actorId: tenant?.actorId ?? undefined,
      actorType: tenant?.actorType ?? undefined,
    },
  );

  const status = (result[4] as GuardStatus[] | undefined)?.[0];

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
