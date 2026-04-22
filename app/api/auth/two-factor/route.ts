import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";
import { publish } from "@/server/event-queue/publisher";
import { getDb, rid } from "@/server/db/connection";
import { listVerifiedChannelTypes } from "@/server/db/queries/entity-channels";
import {
  generateSecret,
  generateURI,
  NobleCryptoPlugin,
  ScureBase32Plugin,
  TOTP,
} from "otplib";

/**
 * POST /api/auth/two-factor
 *
 * User-level 2FA management (§19.15). All actions require authentication as a
 * `user` actor; other actor types (api_token, connected_app) are rejected.
 *
 *   action: "setup-totp"    → generate a provisioning URI + secret
 *   action: "confirm-totp"  → verify the first code and fire the confirmation
 *                             email (payload.twoFactorSecret). The flag is
 *                             flipped in /verify.
 *   action: "disable"       → fire the confirmation email for disabling 2FA.
 */

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
  if (ctx.claims?.actorType !== "user") {
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
  const userId = ctx.claims.actorId;
  const systemSlug = ctx.tenant.systemSlug;

  const db = await getDb();

  if (action === "setup-totp") {
    // Generate a fresh TOTP secret client-side (the browser never sees it
    // again after this response — it only shows the QR code / URI).
    const issuer = (await core.getSetting("auth.twoFactor.issuer")) ?? "Core";
    const userProfile = await db.query<
      [{ profile: { name: string; channels: { value: string }[] } }[]]
    >(
      `SELECT profile FROM $userId FETCH profile, profile.channels`,
      { userId: rid(userId) },
    );
    const accountLabel = userProfile[0]?.[0]?.profile?.channels?.[0]?.value ??
      userProfile[0]?.[0]?.profile?.name ?? "user";

    const secret = await generateSecret({
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

    return Response.json({
      success: true,
      data: { provisioningUri: uri, secret },
    });
  }

  if (action === "confirm-totp") {
    const { code, secret } = body as { code?: string; secret?: string };
    if (!code || !secret) {
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
      payload: { twoFactorSecret: secret },
      tenant: {
        companyId: ctx.tenant.companyId,
        systemId: ctx.tenant.systemId,
        systemSlug,
        actorId: userId,
        actorType: "user",
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
        systemSlug,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId);
    const defaultChannels = await core.getSetting(
      "auth.communication.defaultChannels",
      systemSlug,
    );

    await publish("send_communication", {
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
        companyId: ctx.tenant.companyId,
        systemId: ctx.tenant.systemId,
        systemSlug,
        actorId: userId,
        actorType: "user",
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
        systemSlug,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

    const verifiedTypes = await listVerifiedChannelTypes(userId);
    const defaultChannels = await core.getSetting(
      "auth.communication.defaultChannels",
      systemSlug,
    );

    await publish("send_communication", {
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
  withRateLimit({ windowMs: 60_000, maxRequests: 10 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => handler(req, ctx),
);
