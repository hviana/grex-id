import { generateSecureToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import type {
  VerificationOwnerType,
  VerificationRequestTenantContext,
} from "@/src/contracts/verification-request";
import { assertServerOnly } from "./server-only.ts";
import { atomicCommunicationGuard } from "../db/queries/verification.ts";

assertServerOnly("verification-guard.ts");

import type { CommunicationGuardResult } from "@/src/contracts/high-level/verification";
export type { CommunicationGuardResult };

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
  const system = systemSlug
    ? await core.getSystemBySlug(systemSlug)
    : undefined;
  const settingScope = system ? { systemId: system.id } : undefined;

  const expiryMinutes = Number(
    (await core.getSetting(
      "auth.communication.expiry.minutes",
      settingScope,
    )) ||
      15,
  );
  const maxCount = Number(
    (await core.getSetting("auth.communication.maxCount", settingScope)) || 5,
  );
  const windowHours = Number(
    (await core.getSetting("auth.communication.windowHours", settingScope)) ||
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
