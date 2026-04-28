import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";
import {
  findUserChannelByTypeValue,
  listVerifiedChannelTypes,
} from "@/server/db/queries/entity-channels";
import { userHasVerifiedChannel } from "@/server/db/queries/auth";
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
    data: { message: "auth.verify.resent" },
  });

  if (!raw || typeof raw !== "string") return successResponse;

  const type = guessChannelType(raw);
  const value = type
    ? await standardizeField(type, raw, "entity_channel")
    : raw.trim();

  // Locate the unverified channel belonging to a user that matches the
  // identifier. entity_channel rows have no back-pointer — resolve the owner
  // by checking which user references the matching channel id.
  const row = await findUserChannelByTypeValue(type, value);
  if (!row) return successResponse;

  if (row.verified) {
    // Already confirmed — no resend needed.
    return successResponse;
  }

  // If the user already has a verified channel elsewhere, we treat this as
  // an "entity channel add" resend, otherwise a "register" resend.
  const approved = await userHasVerifiedChannel(String(row.ownerId));
  const actionKey = approved
    ? "auth.action.entityChannelAdd"
    : "auth.action.register";

  const guardResult = await communicationGuard({
    ownerId: String(row.ownerId),
    ownerType: "user",
    actionKey,
    payload: { changes: [{ action: "update", entity: "entity_channel", id: String(row.id), fields: { verified: true } }] },
    tenant: { systemSlug },
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
  const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

  // Channel order: start with the type being confirmed, then the owner's
  // other verified types as fallback.
  const otherVerified = await listVerifiedChannelTypes(
    String(row.ownerId),
    "user",
  );
  const channels = [
    type ?? "email",
    ...otherVerified.filter((t) => t !== type),
  ];

  const user = await genericGetById<{
    profileId: { name: string; locale?: string };
  }>({ table: "user", fetch: "profileId" }, String(row.ownerId));
  const name = user?.profileId?.name ?? "";
  const locale = user?.profileId?.locale;

  await dispatchCommunication({
    channels,
    recipients: [String(row.ownerId)],
    template: "human-confirmation",
    allowUnverified: true,
    templateData: {
      actionKey,
      confirmationLink,
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
