import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { publish } from "@/server/event-queue/publisher";
import { communicationGuard } from "@/server/utils/verification-guard";
import {
  findVerifiedOwnerByChannelValue,
  listVerifiedChannelTypes,
} from "@/server/db/queries/entity-channels";
import { userHasVerifiedChannel } from "@/server/db/queries/auth";
import { getDb, rid } from "@/server/db/connection";

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
  const raw = (body.identifier ?? body.email) as string | undefined;

  const successResponse = Response.json({
    success: true,
    data: { message: "auth.verify.resent" },
  });

  if (!raw || typeof raw !== "string") return successResponse;

  const type = guessChannelType(raw);
  const value = type
    ? standardizeField(type, raw, "entity_channel")
    : raw.trim();

  // Locate the unverified channel belonging to a user that matches the
  // identifier — we look up by (type, value) irrespective of verified status,
  // since the point of resend is exactly to re-verify.
  const db = await getDb();
  const rowResult = await db.query<[
    { id: string; ownerId: string; ownerType: string; verified: boolean }[],
  ]>(
    `SELECT id, ownerId, ownerType, verified FROM entity_channel
     WHERE ownerId IN (SELECT VALUE id FROM user)
       AND type = $type AND value = $value
     LIMIT 1`,
    { type, value },
  );
  const row = rowResult[0]?.[0];
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
    payload: { channelIds: [String(row.id)] },
    tenant: { systemSlug, actorType: "anonymous" },
  });

  if (!guardResult.allowed) return successResponse;

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
    "http://localhost:3000";
  const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

  // Channel order: start with the type being confirmed, then the owner's
  // other verified types as fallback.
  const otherVerified = await listVerifiedChannelTypes(String(row.ownerId));
  const channels = [
    type ?? "email",
    ...otherVerified.filter((t) => t !== type),
  ];

  const profile = await db.query<
    [{ profile: { name: string; locale?: string } }[]]
  >(
    `SELECT profile FROM $userId FETCH profile`,
    { userId: rid(String(row.ownerId)) },
  );
  const name = profile[0]?.[0]?.profile?.name ?? "";
  const locale = profile[0]?.[0]?.profile?.locale;

  await publish("send_communication", {
    channels,
    recipients: [String(row.ownerId)],
    template: "human-confirmation",
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

export const POST = compose(withAuthRateLimit(), handler);
