import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";
import {
  findVerifiedOwnerByChannelValue,
  listVerifiedChannelTypes,
} from "@/server/db/queries/entity-channels";
import { getUserProfile } from "@/server/db/queries/auth";

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

function guessChannelType(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return "phone";
  return undefined;
}

async function handler(
  req: Request,
  _ctx: RequestContext,
): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json();
  const systemSlug = body.systemSlug as string | undefined;
  const raw = body.identifier as string | undefined;

  const successResponse = Response.json({
    success: true,
    data: { message: "auth.forgotPassword.success" },
  });

  if (!raw || typeof raw !== "string") return successResponse;

  const type = guessChannelType(raw);
  const value = type
    ? await standardizeField(type, raw, "entity_channel")
    : raw.trim();

  const match = await findVerifiedOwnerByChannelValue(value);
  if (!match || match.ownerKind !== "user") return successResponse;

  const guardResult = await communicationGuard({
    ownerId: match.ownerId,
    ownerType: "user",
    actionKey: "auth.action.passwordReset",
    tenant: {
      systemSlug,
    },
  });

  if (!guardResult.allowed) return successResponse;

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
    "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${guardResult.token}`;

  // Channel preference: the matched channel type first, then the user's
  // remaining verified channels (§8.7).
  const matchedType = match.channel.type;
  const allTypes = await listVerifiedChannelTypes(match.ownerId, "user");
  const channelOrder = [
    matchedType,
    ...allTypes.filter((t) => t !== matchedType),
  ];

  const profileData = await getUserProfile(match.ownerId);
  const name = profileData?.name ?? "";
  const locale = profileData?.locale;

  await dispatchCommunication({
    channels: channelOrder,
    recipients: [match.ownerId],
    template: "human-confirmation",
    templateData: {
      actionKey: "auth.action.passwordReset",
      confirmationLink: resetLink,
      occurredAt: new Date().toISOString(),
      actorName: name,
      expiryMinutes: String(expiryMinutes),
      locale,
      systemSlug,
    },
  });

  return successResponse;
}

export const POST = compose(withAuthRateLimit(), handler);
