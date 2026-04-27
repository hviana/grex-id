import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";
import {
  findVerifiedOwnerByChannelValue,
  listVerifiedChannelTypes,
} from "@/server/db/queries/entity-channels";
import { genericGetById } from "@/server/db/queries/generics";


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
  const system = systemSlug
    ? await core.getSystemBySlug(systemSlug)
    : undefined;
  const settingScope = system ? { systemId: system.id } : undefined;
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
    (await core.getSetting(
      "auth.communication.expiry.minutes",
      settingScope,
    )) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
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

  const user = await genericGetById<{
    profileId: { name: string; locale?: string };
  }>({ table: "user", fetch: "profileId" }, match.ownerId);
  const name = user?.profileId?.name ?? "";
  const locale = user?.profileId?.locale;

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

export const POST = compose(withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }), handler);
