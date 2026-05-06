import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { get } from "@/server/utils/cache";
import { standardizeField } from "@/server/utils/field-standardizer";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";
import {
  findVerifiedOwnerByChannelValue,
  listVerifiedChannelTypes,
} from "@/server/db/queries/entity-channels";
import { genericGetById } from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";

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
  const { body, error } = await parseBody(req);
  if (error) return error;
  const systemSlug = body.systemSlug as string | undefined;
  const coreData = await get(undefined, "core-data") as any;
  const system = systemSlug ? coreData.systemsBySlug[systemSlug] : undefined;
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
  if (!match) return successResponse;

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
    (await get(settingScope, "setting.auth.communication.expiry.minutes")) ||
      15,
  );
  const baseUrl = (await get(settingScope, "setting.app.baseUrl")) ??
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

  const user = await genericGetById<{ id: string }>(
    {
      table: "user",
      cascade: [{ table: "profile", sourceField: "profileId" }],
      skipAccessCheck: true,
    },
    match.ownerId,
  );
  const profileData = user?._cascade?.profileId as {
    name?: string;
    locale?: string;
  } | null;
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

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }),
  handler,
);
