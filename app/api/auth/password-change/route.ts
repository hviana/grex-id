import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  getUserProfile,
  hashPassword,
  verifyPassword,
} from "@/server/db/queries/auth";
import { listVerifiedChannelTypes } from "@/server/db/queries/entity-channels";
import { validateField } from "@/server/utils/field-validator";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json();
  const {
    currentPassword,
    newPassword,
    confirmPassword,
  } = body as {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  const userId = ctx.claims!.actorId;
  const tenantId = ctx.tenant.id;
  const systemSlug = ctx.tenant.systemSlug;

  if (!currentPassword || !newPassword) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.password.required"] },
      },
      { status: 400 },
    );
  }

  const newPasswordErrors = await validateField(
    "password",
    newPassword,
    "user",
  );
  if (newPasswordErrors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: newPasswordErrors },
      },
      { status: 400 },
    );
  }

  if (newPassword !== confirmPassword) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.password.mismatch"] },
      },
      { status: 400 },
    );
  }

  // Verify the current password via SurrealDB's argon2 compare (§8.7 step 1).
  const currentValid = await verifyPassword(userId, currentPassword);
  if (!currentValid) {
    return Response.json(
      {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "auth.passwordChange.error.invalidCurrent",
        },
      },
      { status: 401 },
    );
  }

  // Pre-hash the new password inside SurrealDB so the plaintext never enters
  // the verification_request payload (§5.1 rule 5, §8.7 step 3).
  const newPasswordHash = await hashPassword(newPassword);
  if (!newPasswordHash) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  const guardResult = await communicationGuard({
    ownerId: userId,
    ownerType: "user",
    actionKey: "auth.action.passwordChange",
    payload: { newPasswordHash },
    tenant: {
      tenantId,
      systemSlug,
    },
  });

  if (!guardResult.allowed) {
    const message = guardResult.reason === "previousNotExpired"
      ? "validation.verification.previousNotExpired"
      : "validation.verification.rateLimited";
    return Response.json(
      { success: false, error: { code: "COOLDOWN", message } },
      { status: 429 },
    );
  }

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
    "http://localhost:3000";
  const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

  // Channel order: the owner's verified channel types, respecting the default
  // precedence when present.
  const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
  const defaultChannelsRaw =
    (await core.getSetting("auth.communication.defaultChannels", systemSlug)) ??
      "[]";
  let defaultChannels: string[] = [];
  try {
    const parsed = JSON.parse(defaultChannelsRaw);
    if (Array.isArray(parsed)) {
      defaultChannels = parsed.filter(
        (c): c is string => typeof c === "string",
      );
    }
  } catch {
    // fall through — unordered verified list
  }
  const channelOrder = [
    ...defaultChannels.filter((c) => verifiedTypes.includes(c)),
    ...verifiedTypes.filter((c) => !defaultChannels.includes(c)),
  ];

  const profileData = await getUserProfile(userId);
  const name = profileData?.name ?? "";
  const locale = profileData?.locale;

  await dispatchCommunication({
    channels: channelOrder,
    recipients: [userId],
    template: "human-confirmation",
    templateData: {
      actionKey: "auth.action.passwordChange",
      confirmationLink,
      occurredAt: new Date().toISOString(),
      actorName: name,
      expiryMinutes: String(expiryMinutes),
      locale,
      systemSlug,
    },
  });

  return Response.json({
    success: true,
    data: { message: "auth.passwordChange.confirmationSent" },
  });
}

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 10 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => handler(req, ctx),
);
