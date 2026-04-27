import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { storePendingTwoFactorSecret } from "@/server/db/queries/auth";
import { listVerifiedChannelTypes } from "@/server/db/queries/entity-channels";
import { genericDecrypt, genericGetById } from "@/server/db/queries/generics";
import { encryptField } from "@/server/utils/crypto";
import {
  generateSecret,
  generateURI,
  NobleCryptoPlugin,
  ScureBase32Plugin,
  TOTP,
} from "otplib";

function channelOrder(
  verifiedTypes: string[],
  defaultChannelsRaw: string | undefined,
): string[] {
  let defaultChannels: string[] = [];
  try {
    const parsed = JSON.parse(defaultChannelsRaw ?? "[]");
    if (Array.isArray(parsed)) {
      defaultChannels = parsed.filter(
        (c): c is string => typeof c === "string",
      );
    }
  } catch {
    // ignore
  }
  return [
    ...defaultChannels.filter((c) => verifiedTypes.includes(c)),
    ...verifiedTypes.filter((c) => !defaultChannels.includes(c)),
  ];
}

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const { tenant } = ctx.tenantContext;
  const actorType = ctx.tenantContext.actorType;

  if (actorType !== "user") {
    return Response.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "auth.error.insufficientRole",
        },
      },
      { status: 403 },
    );
  }

  const core = Core.getInstance();
  const body = await req.json().catch(() => ({}));
  const { action } = body as { action?: string };
  const userId = tenant.actorId!;
  const tenantId = tenant.id!;
  const systemSlug = ctx.tenantContext.systemSlug ?? "core";
  const settingScope = { systemId: tenant.systemId };

  if (action === "setup-totp") {
    const issuer = (await core.getSetting("auth.twoFactor.issuer")) ?? "Core";
    const userRow = await genericGetById<{
      profileId: { name: string; locale?: string };
      channelIds: { value: string }[];
    }>({ table: "user", fetch: "profileId, channelIds" }, userId);
    const accountLabel = userRow?.channelIds?.[0]?.value ??
      userRow?.profileId?.name ?? "user";

    const secret = generateSecret({
      length: 20,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    const uri = generateURI({
      strategy: "totp",
      issuer,
      label: accountLabel,
      secret,
    });

    const secretEnvelope = await encryptField(secret);
    await storePendingTwoFactorSecret(userId, secretEnvelope);

    return Response.json({
      success: true,
      data: { provisioningUri: uri },
    });
  }

  if (action === "confirm-totp") {
    const { code } = body as { code?: string };
    if (!code) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.code.required"],
          },
        },
        { status: 400 },
      );
    }

    let secret: string;
    try {
      const decrypted = await genericDecrypt(
        { table: "user", decryptFields: [{ field: "pendingTwoFactorSecret" }] },
        userId,
      );
      secret = decrypted.pendingTwoFactorSecret ?? "";
      if (!secret) throw new Error("empty");
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "2FA_INVALID",
            message: "common.twoFactor.error.invalidCode",
          },
        },
        { status: 400 },
      );
    }

    const totp = new TOTP({
      secret,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    const result = await totp.verify(code);
    if (!result.valid) {
      return Response.json(
        {
          success: false,
          error: {
            code: "2FA_INVALID",
            message: "common.twoFactor.error.invalidCode",
          },
        },
        { status: 400 },
      );
    }

    const guard = await communicationGuard({
      ownerId: userId,
      ownerType: "user",
      actionKey: "auth.action.twoFactorEnable",
      payload: {},
      tenant: {
        tenantIds: [tenantId],
        systemSlug,
      },
    });

    if (!guard.allowed) {
      const message = guard.reason === "previousNotExpired"
        ? "validation.verification.previousNotExpired"
        : "validation.verification.rateLimited";
      return Response.json(
        { success: false, error: { code: "COOLDOWN", message } },
        { status: 429 },
      );
    }

    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        settingScope,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
    const defaultChannels = await core.getSetting(
      "auth.communication.defaultChannels",
      settingScope,
    );

    await dispatchCommunication({
      channels: channelOrder(verifiedTypes, defaultChannels),
      recipients: [userId],
      template: "human-confirmation",
      templateData: {
        actionKey: "auth.action.twoFactorEnable",
        confirmationLink,
        occurredAt: new Date().toISOString(),
        expiryMinutes: String(expiryMinutes),
        systemSlug,
      },
    });

    return Response.json({
      success: true,
      data: { message: "common.twoFactor.setup.confirmationSent" },
    });
  }

  if (action === "disable") {
    const guard = await communicationGuard({
      ownerId: userId,
      ownerType: "user",
      actionKey: "auth.action.twoFactorDisable",
      payload: {},
      tenant: {
        tenantIds: [tenantId],
        systemSlug,
      },
    });

    if (!guard.allowed) {
      const message = guard.reason === "previousNotExpired"
        ? "validation.verification.previousNotExpired"
        : "validation.verification.rateLimited";
      return Response.json(
        { success: false, error: { code: "COOLDOWN", message } },
        { status: 429 },
      );
    }

    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        settingScope,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
    const defaultChannels = await core.getSetting(
      "auth.communication.defaultChannels",
      settingScope,
    );

    await dispatchCommunication({
      channels: channelOrder(verifiedTypes, defaultChannels),
      recipients: [userId],
      template: "human-confirmation",
      templateData: {
        actionKey: "auth.action.twoFactorDisable",
        confirmationLink,
        occurredAt: new Date().toISOString(),
        expiryMinutes: String(expiryMinutes),
        systemSlug,
      },
    });

    return Response.json({
      success: true,
      data: { message: "common.twoFactor.disable.confirmationSent" },
    });
  }

  return Response.json(
    {
      success: false,
      error: { code: "VALIDATION", errors: ["validation.action.invalid"] },
    },
    { status: 400 },
  );
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 10 },
    requireAuthenticated: true,
  }),
  handler,
);
