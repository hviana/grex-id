import { getDb, rid } from "../connection.ts";
import type {
  VerificationOwnerType,
  VerificationRequestTenantContext,
} from "@/src/contracts/verification-request";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("verification");

/**
 * Atomic communication guard query (§4.12).
 *
 * Checks for a previous non-expired verification request and rate limit
 * in a single batched query. If both pass, atomically creates the new
 * verification_request row.
 *
 * verification_request has `tenantIds: array<record<tenant>>` instead of separate
 * `companyId`/`systemId`/`systemSlug`/`actorId`/`actorType` fields.
 * The tenantIds links to the full tenant context.
 *
 * Returns an array where the last element is a status object with:
 *   blockedByPrevious, blockedByRateLimit, allowed
 */
export async function atomicCommunicationGuard(params: {
  ownerId: string;
  ownerType: VerificationOwnerType;
  actionKey: string;
  verificationToken: string;
  expiresAt: Date;
  payload?: Record<string, unknown>;
  windowStart: Date;
  maxCount: number;
  tenant?: VerificationRequestTenantContext;
}): Promise<unknown[]> {
  const db = await getDb();
  return db.query(
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
        tenantIds = IF $tenantId != NONE THEN [$tenantId] ELSE NONE END
    ) ELSE [] END;

    [{
      blockedByPrevious: array::len($lastActive) > 0,
      blockedByRateLimit: $wCnt >= $maxCount,
      allowed: array::len($created) > 0
    }];`,
    {
      ownerId: rid(String(params.ownerId)),
      ownerType: params.ownerType,
      actionKey: params.actionKey,
      verificationToken: params.verificationToken,
      expiresAt: params.expiresAt,
      payload: params.payload ?? undefined,
      windowStart: params.windowStart,
      maxCount: params.maxCount,
      tenantId: params.tenant?.tenantIds?.[0]
        ? rid(params.tenant.tenantIds[0])
        : undefined,
    },
  );
}
