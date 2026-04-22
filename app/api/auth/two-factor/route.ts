import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";
import { publish } from "@/server/event-queue/publisher";
import { getDb, rid } from "@/server/db/connection";
import { listVerifiedChannelTypes } from "@/server/db/queries/entity-channels";
import { decryptField, encryptField } from "@/server/utils/crypto";
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
    // Generate a fresh TOTP secret and stash it on the user row as
    // `pendingTwoFactorSecret`. The secret never travels through
    // `verification_request.payload` (§15.1 rule 5 — no secrets in payload).
    const issuer = (await core.getSetting("auth.twoFactor.issuer")) ?? "Core";
    const userRow = await db.query<
      [{ profile: { name: string }; channels: { value: string }[] }[]]
    >(
      `SELECT profile, channels FROM $userId FETCH profile, channels`,
      { userId: rid(userId) },
    );
    const accountLabel = userRow[0]?.[0]?.channels?.[0]?.value ??
      userRow[0]?.[0]?.profile?.name ?? "user";

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

    // Store the AES-256-GCM envelope, never the raw base32 secret (§7.1.1).
    const secretEnvelope = await encryptField(secret);
    await db.query(
      `UPDATE $userId SET pendingTwoFactorSecret = $secret, updatedAt = time::now()`,
      { userId: rid(userId), secret: secretEnvelope },
    );

    // Return only the provisioning URI to the browser. The raw secret is
    // embedded in that URI by design (otpauth:// format) so the authenticator
    // app can consume it — but the browser does not need to echo it back.
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

    // Load the pending secret envelope we stashed on `setup-totp` and
    // decrypt once (§12.15) for the TOTP comparison. The plaintext stays
    // in request scope.
    const pending = await db.query<[{ pendingTwoFactorSecret?: string }[]]>(
      `SELECT pendingTwoFactorSecret FROM $userId LIMIT 1`,
      { userId: rid(userId) },
    );
    const envelope = pending[0]?.[0]?.pendingTwoFactorSecret;
    if (!envelope) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["common.twoFactor.error.invalidCode"],
          },
        },
        { status: 400 },
      );
    }

    let secret: string;
    try {
      secret = await decryptField(envelope);
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

    // Fire the confirmation link. The pending secret stays on the user row;
    // the verify handler promotes it to `twoFactorSecret` and clears the
    // pending field when the link is clicked.
    const guard = await communicationGuard({
      ownerId: userId,
      ownerType: "user",
      actionKey: "auth.action.twoFactorEnable",
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

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
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

    const verifiedTypes = await listVerifiedChannelTypes(userId, "user");
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
