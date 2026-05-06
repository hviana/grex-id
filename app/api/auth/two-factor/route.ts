import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { get } from "@/server/utils/cache";
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
  defaultChannelsRaw: string | string[] | undefined,
): string[] {
  let defaultChannels: string[] = [];
  try {
    const parsed = typeof defaultChannelsRaw === "string"
      ? JSON.parse(defaultChannelsRaw)
      : defaultChannelsRaw;
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

  const body = await req.json().catch(() => ({}));
  const { action } = body as { action?: string };
  const userId = tenant.actorId!;
  const tenantId = tenant.id!;
  const systemSlug = ctx.tenantContext.systemSlug ?? "core";
  const settingScope = { systemId: tenant.systemId };

  if (action === "setup-totp") {
    const issuer = (await get(undefined, "setting.auth.twoFactor.issuer") as
      | string
      | undefined) ?? "Core";
    const userRow = await genericGetById<{ id: string }>(
      {
        table: "user",
        cascade: [
          { table: "profile", sourceField: "profileId" },
          { table: "entity_channel", sourceField: "channelIds", isArray: true },
        ],
        skipAccessCheck: true,
      },
      userId,
    );
    const channels = userRow?._cascade?.channelIds as
      | { value: string }[]
      | null;
    const profile = userRow?._cascade?.profileId as { name?: string } | null;
    const accountLabel = channels?.[0]?.value ??
      profile?.name ?? "user";

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
        {
          table: "user",
          decryptFields: [{ field: "pendingTwoFactorSecret" }],
          skipAccessCheck: true,
        },
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
      payload: {
        changes: [{
          action: "custom",
          actionKey: "auth.action.twoFactorEnable",
          entity: "user",
          id: userId,
          fields: {},
        }],
      },
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
      (await get(settingScope, "setting.auth.communication.expiry.minutes")) ||
        15,
    );
    const baseUrl =
      (await get(settingScope, "setting.app.baseUrl") as string | undefined) ??
        "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
    const defaultChannels = await get(
      settingScope,
      "setting.auth.communication.defaultChannels",
    ) as string | string[] | undefined;

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
      payload: {
        changes: [{
          action: "update",
          actionKey: "auth.action.twoFactorDisable",
          entity: "user",
          id: userId,
          fields: { twoFactorEnabled: false, twoFactorSecret: null },
        }],
      },
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
      (await get(settingScope, "setting.auth.communication.expiry.minutes")) ||
        15,
    );
    const baseUrl =
      (await get(settingScope, "setting.app.baseUrl") as string | undefined) ??
        "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
    const defaultChannels = await get(
      settingScope,
      "setting.auth.communication.defaultChannels",
    ) as string | string[] | undefined;

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
