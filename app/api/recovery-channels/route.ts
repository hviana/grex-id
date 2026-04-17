import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import { generateSecureToken } from "@/server/utils/token";
import {
  createVerificationRequest,
  getLastVerificationRequest,
} from "@/server/db/queries/auth";
import {
  createRecoveryChannel,
  deleteRecoveryChannel,
  findRecoveryChannelById,
  findRecoveryChannelByUserAndValue,
  listRecoveryChannels,
} from "@/server/db/queries/recovery-channels";
import Core from "@/server/utils/Core";

async function sendChannelVerification(
  userId: string,
  channelId: string,
  channelType: "email" | "phone",
  channelValue: string,
  userName: string,
  systemSlug: string,
): Promise<void> {
  const core = Core.getInstance();
  const verificationExpiryMinutes = Number(
    await core.getSetting("auth.recoveryChannel.verification.expiry.minutes"),
  );
  const token = generateSecureToken();
  await createVerificationRequest({
    userId,
    type: "recovery_verify",
    token,
    expiresAt: new Date(Date.now() + verificationExpiryMinutes * 60_000),
    payload: { channelId },
  });

  const baseUrl = (await core.getSetting("app.baseUrl")) ??
    "http://localhost:3000";
  const verificationLink = `${baseUrl}/verify?token=${token}`;
  const eventData = {
    recipients: [channelValue],
    template: "recovery-verify",
    templateData: {
      name: userName,
      verificationLink,
      channelValue,
      expiryMinutes: String(verificationExpiryMinutes),
    },
    systemSlug,
  };

  await publish(channelType === "email" ? "SEND_EMAIL" : "SEND_SMS", eventData);
}

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
        {
          success: false,
          error: { code: "VALIDATION", errors: ["validation.id.required"] },
        },
        { status: 400 },
      );
    }

    const channel = await findRecoveryChannelById(channelId);
    if (!channel || String(channel.userId) !== String(userId)) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 404 },
      );
    }

    if (channel.verified) {
      return Response.json(
        {
          success: false,
          error: {
            code: "ERROR",
            message: "auth.recoveryChannel.error.notVerified",
          },
        },
        { status: 400 },
      );
    }

    // Cooldown check
    const core = Core.getInstance();
    const cooldownSeconds = Number(
      await core.getSetting("auth.verification.cooldown.seconds"),
    );
    const lastRequest = await getLastVerificationRequest(
      userId,
      "recovery_verify",
    );
    if (lastRequest) {
      const elapsed = Date.now() - new Date(lastRequest.createdAt).getTime();
      if (elapsed < cooldownSeconds * 1000) {
        return Response.json(
          {
            success: false,
            error: { code: "ERROR", message: "common.error.rateLimited" },
          },
          { status: 429 },
        );
      }
    }

    // Get user name from claims profile
    const name = (ctx.claims as any)?.profile?.name ?? "";

    await sendChannelVerification(
      userId,
      String(channel.id),
      channel.type as "email" | "phone",
      channel.value,
      name,
      ctx.tenant.systemSlug,
    );

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
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.recoveryChannel.type.required"],
        },
      },
      { status: 400 },
    );
  }

  const fieldType = type === "email" ? "email" : "phone";
  const stdValue = standardizeField(fieldType, value, "recovery_channel");

  const valueErrors = validateField(fieldType, stdValue, "user");
  if (valueErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: valueErrors } },
      { status: 400 },
    );
  }

  // Check duplicate channel for this user
  const existing = await findRecoveryChannelByUserAndValue(
    userId,
    type,
    stdValue,
  );
  if (existing) {
    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "auth.recoveryChannel.error.duplicate",
        },
      },
      { status: 409 },
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
      {
        success: false,
        error: {
          code: "ERROR",
          message: "auth.recoveryChannel.error.maxReached",
        },
      },
      { status: 400 },
    );
  }

  // Get user name from claims profile
  const name = (ctx.claims as any)?.profile?.name ?? "";

  await sendChannelVerification(
    userId,
    String(channel.id),
    type,
    stdValue,
    name,
    ctx.tenant.systemSlug,
  );

  return Response.json({ success: true, data: channel }, { status: 201 });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { channelId } = body;
  const userId = ctx.claims!.actorId;

  if (!channelId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  // Verify ownership
  const channel = await findRecoveryChannelById(channelId);
  if (!channel || String(channel.userId) !== String(userId)) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
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
