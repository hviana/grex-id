import "server-only";

import { generateSecureToken } from "@/server/utils/token";
import { get } from "@/server/utils/cache";
import type {
  VerificationOwnerType,
  VerificationRequestTenantContext,
} from "@/src/contracts/high-level/verification";
import { atomicCommunicationGuard } from "../db/queries/verification.ts";

import type { CommunicationGuardResult } from "@/src/contracts/high-level/verification";
export type { CommunicationGuardResult };

export async function communicationGuard(params: {
  ownerId: string;
  ownerType: VerificationOwnerType;
  actionKey: string;
  payload?: Record<string, unknown>;
  tenant?: VerificationRequestTenantContext;
}): Promise<CommunicationGuardResult> {
  const { ownerId, ownerType, actionKey, payload, tenant } = params;
  const systemSlug = tenant?.systemSlug;
  let settingScope: { systemId: string } | undefined;
  if (systemSlug) {
    const coreData = (await get(undefined, "core-data")) as any;
    const system = coreData.systemsBySlug[systemSlug];
    if (system) {
      settingScope = { systemId: system.id };
    }
  }

  const expiryMinutes = Number(
    (await get(
      settingScope,
      "setting.auth.communication.expiry.minutes",
    )) ||
      15,
  );
  const maxCount = Number(
    (await get(settingScope, "setting.auth.communication.maxCount")) || 5,
  );
  const windowHours = Number(
    (await get(settingScope, "setting.auth.communication.windowHours")) ||
      1,
  );

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
  const windowStart = new Date(Date.now() - windowHours * 3_600_000);

  const result = await atomicCommunicationGuard({
    ownerId,
    ownerType,
    actionKey,
    verificationToken: token,
    expiresAt,
    payload,
    windowStart,
    maxCount,
    tenant,
  });

  type GuardStatus = {
    blockedByPrevious: boolean;
    blockedByRateLimit: boolean;
    allowed: boolean;
  };

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
