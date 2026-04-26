import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import {
  countVerifiedChannelsOfType,
  createChannel,
  deleteChannel,
  findChannelById,
  findChannelByOwnerTypeAndValue,
  findVerifiedOwnerByTypedChannel,
  getUserProfileName,
  listChannelsByOwner,
  listVerifiedChannelTypes,
  userOwnsChannel,
} from "@/server/db/queries/entity-channels";
import Core from "@/server/utils/Core";
import {
  communicationGuard,
  type CommunicationGuardResult,
} from "@/server/utils/verification-guard";

async function sendChannelConfirmation(
  userId: string,
  channelId: string,
  channelType: string,
  userName: string,
  systemSlug: string,
  systemId: string,
  tenantId: string,
  actionKey: "auth.action.register" | "auth.action.entityChannelAdd",
): Promise<CommunicationGuardResult> {
  const guardResult = await communicationGuard({
    ownerId: userId,
    ownerType: "user",
    actionKey,
    payload: { channelIds: [channelId] },
    tenant: { tenantIds: [tenantId], systemSlug },
  });

  if (!guardResult.allowed) return guardResult;

  const core = Core.getInstance();
  const settingScope = { systemId };
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

  // The primary channel is the one being verified; fall back to the owner's
  // other verified channels if delivery fails.
  const otherVerified = await listVerifiedChannelTypes(userId, "user");
  const channels = [
    channelType,
    ...otherVerified.filter((t) => t !== channelType),
  ];

  await dispatchCommunication({
    channels,
    recipients: [userId],
    template: "human-confirmation",
    allowUnverified: true,
    templateData: {
      actionKey,
      confirmationLink,
      occurredAt: new Date().toISOString(),
      actorName: userName,
      expiryMinutes: String(expiryMinutes),
      systemSlug,
    },
  });

  return guardResult;
}

async function getHandler(_req: Request, ctx: RequestContext) {
  const userId = ctx.tenant.actorId!;
  const channels = await listChannelsByOwner(userId, "user");
  return Response.json({ success: true, data: channels });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const userId = ctx.tenant.actorId!;

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

    const channel = await findChannelById(channelId);
    if (!channel || !(await userOwnsChannel(userId, String(channel.id)))) {
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
            message: "auth.entityChannel.error.alreadyVerified",
          },
        },
        { status: 400 },
      );
    }

    const name = await getUserProfileName(userId);

    // Pending confirmation: unverified channel still needs an initial
    // verified channel on the account to distinguish register from add.
    const anyVerified =
      (await listVerifiedChannelTypes(userId, "user")).length > 0;
    const actionKey = anyVerified
      ? "auth.action.entityChannelAdd"
      : "auth.action.register";

    const result = await sendChannelConfirmation(
      userId,
      String(channel.id),
      channel.type,
      name,
      ctx.tenant.systemSlug,
      ctx.tenant.systemId,
      ctx.tenant.id,
      actionKey,
    );

    if (!result.allowed) {
      const message = result.reason === "previousNotExpired"
        ? "validation.verification.previousNotExpired"
        : "validation.verification.rateLimited";
      return Response.json(
        { success: false, error: { code: "ERROR", message } },
        { status: 429 },
      );
    }

    return Response.json({ success: true });
  }

  const body = await req.json();
  const { type, value } = body;

  if (!type || !value) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: [
            ...(!type ? ["validation.channel.type.required"] : []),
            ...(!value ? ["validation.channel.value.required"] : []),
          ],
        },
      },
      { status: 400 },
    );
  }

  const stdValue = await standardizeField(type, value, "entity_channel");
  const valueErrors = await validateField(type, stdValue, "entity_channel");
  if (valueErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: valueErrors } },
      { status: 400 },
    );
  }

  const existing = await findChannelByOwnerTypeAndValue(
    userId,
    "user",
    type,
    stdValue,
  );
  if (existing) {
    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "auth.entityChannel.error.duplicate",
        },
      },
      { status: 409 },
    );
  }

  // Cross-entity conflict: reject if the channel value is already verified
  // by another user or lead.
  const verifiedOwner = await findVerifiedOwnerByTypedChannel(type, stdValue);
  if (verifiedOwner && verifiedOwner.ownerId !== userId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "CONFLICT",
          errors: ["validation.channel.conflict"],
        },
      },
      { status: 409 },
    );
  }

  const core = Core.getInstance();
  const maxPerOwner = Number(
    (await core.getSetting(
      "auth.entityChannel.maxPerOwner",
      { systemId: ctx.tenant.systemId },
    )) || 10,
  );

  const channel = await createChannel({
    ownerId: userId,
    ownerKind: "user",
    type,
    value: stdValue,
    maxPerOwner,
  });

  if (!channel) {
    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "auth.entityChannel.error.maxReached",
        },
      },
      { status: 400 },
    );
  }

  const name = await getUserProfileName(userId);

  await sendChannelConfirmation(
    userId,
    String(channel.id),
    type,
    name,
    ctx.tenant.systemSlug,
    ctx.tenant.systemId,
    ctx.tenant.id,
    "auth.action.entityChannelAdd",
  );

  return Response.json({ success: true, data: channel }, { status: 201 });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { channelId, requiredTypes } = body as {
    channelId?: string;
    requiredTypes?: string[];
  };
  const userId = ctx.tenant.actorId!;

  if (!channelId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const channel = await findChannelById(channelId);
  if (!channel || !(await userOwnsChannel(userId, String(channel.id)))) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 404 },
    );
  }

  // Required-type invariant: removing a verified channel of a required type
  // must leave at least one other verified channel of that type (§8.7).
  if (channel.verified && requiredTypes?.includes(channel.type)) {
    const remaining = await countVerifiedChannelsOfType(
      userId,
      "user",
      channel.type,
    );
    if (remaining <= 1) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["auth.entityChannel.error.requiredType"],
          },
        },
        { status: 400 },
      );
    }
  }

  await deleteChannel({ channelId, ownerId: userId, ownerKind: "user" });
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
