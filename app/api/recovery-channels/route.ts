import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import { generateSecureToken } from "@/server/utils/token";
import { createVerificationRequest, getLastVerificationRequest } from "@/server/db/queries/auth";
import {
  listRecoveryChannels,
  createRecoveryChannel,
  deleteRecoveryChannel,
  findRecoveryChannelById,
} from "@/server/db/queries/recovery-channels";
import Core from "@/server/utils/Core";
import { getDb, rid } from "@/server/db/connection";

async function getHandler(req: Request, ctx: RequestContext) {
  const userId = ctx.claims!.actorId;
  const channels = await listRecoveryChannels(userId);
  return Response.json({ success: true, data: channels });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const userId = ctx.claims!.actorId;

  // Resend verification for an existing unverified channel
  if (action === "resend-verification") {
    const body = await req.json();
    const { channelId } = body;

    if (!channelId) {
      return Response.json(
        { success: false, error: { code: "VALIDATION", errors: ["validation.id.required"] } },
        { status: 400 },
      );
    }

    const channel = await findRecoveryChannelById(channelId);
    if (!channel || String(channel.userId) !== String(userId)) {
      return Response.json(
        { success: false, error: { code: "ERROR", message: "common.error.generic" } },
        { status: 404 },
      );
    }

    if (channel.verified) {
      return Response.json(
        { success: false, error: { code: "ERROR", message: "auth.recoveryChannel.error.notVerified" } },
        { status: 400 },
      );
    }

    // Cooldown check
    const core = Core.getInstance();
    const cooldownSeconds = Number(
      await core.getSetting("auth.verification.cooldown.seconds"),
    );
    const lastRequest = await getLastVerificationRequest(userId, "recovery_verify");
    if (lastRequest) {
      const elapsed = Date.now() - new Date(lastRequest.createdAt).getTime();
      if (elapsed < cooldownSeconds * 1000) {
        return Response.json(
          { success: false, error: { code: "ERROR", message: "common.error.rateLimited" } },
          { status: 429 },
        );
      }
    }

    // Create new verification request
    const verificationExpiryMinutes = Number(
      await core.getSetting("auth.recoveryChannel.verification.expiry.minutes"),
    );
    const token = generateSecureToken();
    await createVerificationRequest({
      userId,
      type: "recovery_verify",
      token,
      expiresAt: new Date(Date.now() + verificationExpiryMinutes * 60_000),
      payload: { channelId: channel.id },
    });

    const baseUrl = (await core.getSetting("app.baseUrl")) ?? "http://localhost:3000";
    const verificationLink = `${baseUrl}/verify?token=${token}`;

    // Get user profile for template name
    const db = await getDb();
    const userResult = await db.query<[{ profile: { name: string } }[]]>(
      "SELECT profile FROM $userId FETCH profile",
      { userId: rid(userId) },
    );
    const name = (userResult[0]?.[0] as any)?.profile?.name ?? "";

    if (channel.type === "email") {
      await publish("SEND_EMAIL", {
        recipients: [channel.value],
        template: "recovery-verify",
        templateData: { name, verificationLink },
        systemSlug: ctx.tenant.systemSlug,
      });
    } else {
      await publish("SEND_SMS", {
        recipients: [channel.value],
        template: "recovery-verify",
        templateData: { name, verificationLink },
        systemSlug: ctx.tenant.systemSlug,
      });
    }

    return Response.json({ success: true });
  }

  // Add new recovery channel
  const body = await req.json();
  const { type, value } = body;

  if (!type || !value) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: [
            ...(!type ? ["validation.recoveryChannel.type.required"] : []),
            ...(!value ? ["validation.recoveryChannel.value.required"] : []),
          ],
        },
      },
      { status: 400 },
    );
  }

  if (type !== "email" && type !== "phone") {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: ["validation.recoveryChannel.type.required"] } },
      { status: 400 },
    );
  }

  const stdValue = standardizeField(
    type === "email" ? "email" : "phone",
    value,
    "recovery_channel",
  );

  const valueErrors = validateField(
    type === "email" ? "email" : "phone",
    stdValue,
    "user",
  );
  if (valueErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: valueErrors } },
      { status: 400 },
    );
  }

  const core = Core.getInstance();
  const maxPerUser = Number(
    (await core.getSetting("auth.recoveryChannel.maxPerUser")) || 10,
  );

  const channel = await createRecoveryChannel({
    userId,
    type,
    value: stdValue,
    maxPerUser,
  });

  if (!channel) {
    return Response.json(
      { success: false, error: { code: "ERROR", message: "auth.recoveryChannel.error.maxReached" } },
      { status: 400 },
    );
  }

  // Create verification request
  const verificationExpiryMinutes = Number(
    await core.getSetting("auth.recoveryChannel.verification.expiry.minutes"),
  );
  const token = generateSecureToken();
  await createVerificationRequest({
    userId,
    type: "recovery_verify",
    token,
    expiresAt: new Date(Date.now() + verificationExpiryMinutes * 60_000),
    payload: { channelId: channel.id },
  });

  const baseUrl = (await core.getSetting("app.baseUrl")) ?? "http://localhost:3000";
  const verificationLink = `${baseUrl}/verify?token=${token}`;

  // Get user profile for template name
  const db = await getDb();
  const userResult = await db.query<[{ profile: { name: string } }[]]>(
    "SELECT profile FROM $userId FETCH profile",
    { userId: rid(userId) },
  );
  const name = (userResult[0]?.[0] as any)?.profile?.name ?? "";

  if (type === "email") {
    await publish("SEND_EMAIL", {
      recipients: [stdValue],
      template: "recovery-verify",
      templateData: { name, verificationLink },
      systemSlug: ctx.tenant.systemSlug,
    });
  } else {
    await publish("SEND_SMS", {
      recipients: [stdValue],
      template: "recovery-verify",
      templateData: { name, verificationLink },
      systemSlug: ctx.tenant.systemSlug,
    });
  }

  return Response.json({ success: true, data: channel }, { status: 201 });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { channelId } = body;
  const userId = ctx.claims!.actorId;

  if (!channelId) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: ["validation.id.required"] } },
      { status: 400 },
    );
  }

  // Verify ownership
  const channel = await findRecoveryChannelById(channelId);
  if (!channel || String(channel.userId) !== String(userId)) {
    return Response.json(
      { success: false, error: { code: "ERROR", message: "common.error.generic" } },
      { status: 404 },
    );
  }

  await deleteRecoveryChannel(channelId, userId);
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => postHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
