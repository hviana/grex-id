import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { publish } from "@/server/event-queue/publisher";
import { findVerifiedRecoveryChannel } from "@/server/db/queries/recovery-channels";
import { getDb, rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";

function withAuthRateLimit() {
  return async (
    req: Request,
    ctx: RequestContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const core = Core.getInstance();
    const rateLimitPerMinute = Number(
      (await core.getSetting("auth.rateLimit.perMinute")) || 5,
    );
    return withRateLimit({
      windowMs: 60_000,
      maxRequests: rateLimitPerMinute,
    })(req, ctx, next);
  };
}

async function handler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json();
  const { channelValue, systemSlug } = body;

  // Always return success to avoid enumeration
  const successResponse = Response.json({
    success: true,
    data: { message: "auth.accountRecovery.success" },
  });

  if (!channelValue) return successResponse;

  // Determine type from value format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmail = emailRegex.test(channelValue);
  const isPhone = /^\+?\d{10,15}$/.test(
    channelValue.replace(/[\s\-()]/g, ""),
  );

  if (!isEmail && !isPhone) return successResponse;

  const type = isEmail ? "email" as const : "phone" as const;
  const stdValue = standardizeField(
    type === "email" ? "email" : "phone",
    channelValue,
    "recovery_channel",
  );

  // Find verified recovery channel
  const channel = await findVerifiedRecoveryChannel(type, stdValue);
  if (!channel) return successResponse;

  const userId = String(channel.userId);

  const guardResult = await communicationGuard({
    userId,
    type: "password_reset",
    systemSlug,
  });

  if (!guardResult.allowed) return successResponse;

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes")) || 15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl")) ??
    "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${guardResult.token}`;

  const db = await getDb();
  const userResult = await db.query<[{ profile: { name: string } }[]]>(
    "SELECT profile FROM $userId FETCH profile",
    { userId: rid(userId) },
  );
  const name = (userResult[0]?.[0] as any)?.profile?.name ?? "";

  const eventData = {
    recipients: [stdValue],
    template: "recovery-channel-reset",
    templateData: {
      name,
      resetLink,
      channelValue: stdValue,
      expiryMinutes: String(expiryMinutes),
    },
    systemSlug,
  };

  await publish(type === "email" ? "SEND_EMAIL" : "SEND_SMS", eventData);

  return successResponse;
}

export const POST = compose(withAuthRateLimit(), handler);
