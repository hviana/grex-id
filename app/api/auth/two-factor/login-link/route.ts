import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  findUserByVerifiedChannel,
  userHasVerifiedChannel,
  verifyPassword,
} from "@/server/db/queries/auth";
import { communicationGuard } from "@/server/utils/verification-guard";
import { publish } from "@/server/event-queue/publisher";
import { standardizeField } from "@/server/utils/field-standardizer";
import { listVerifiedChannelTypes } from "@/server/db/queries/entity-channels";

function guessChannelType(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return "phone";
  return undefined;
}

function channelOrder(
  verifiedTypes: string[],
  defaultChannelsRaw: string | undefined,
): string[] {
  let defaults: string[] = [];
  try {
    const parsed = JSON.parse(defaultChannelsRaw ?? "[]");
    if (Array.isArray(parsed)) {
      defaults = parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // ignore
  }
  return [
    ...defaults.filter((c) => verifiedTypes.includes(c)),
    ...verifiedTypes.filter((c) => !defaults.includes(c)),
  ];
}

/**
 * POST /api/auth/two-factor/login-link
 *
 * Issues a confirmation link that — when clicked — bypasses TOTP and finishes
 * the login flow (§8.8.3). Unauthenticated by design: authenticates by
 * (identifier, password). All negative paths return a generic success so the
 * endpoint cannot be used to probe for account existence or 2FA status.
 */
async function handler(
  req: Request,
  _ctx: RequestContext,
): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json().catch(() => ({}));
  const { identifier, password, stayLoggedIn } = body as {
    identifier?: string;
    password?: string;
    stayLoggedIn?: boolean;
  };

  // Anti-enumeration: validation failures look just like success.
  const generic = Response.json({
    success: true,
    data: { message: "common.twoFactor.loginLink.sent" },
  });

  if (
    !identifier || !password || typeof identifier !== "string" ||
    typeof password !== "string"
  ) {
    return generic;
  }

  const channelType = guessChannelType(identifier);
  const value = channelType
    ? await standardizeField(channelType, identifier, "entity_channel")
    : identifier.trim();

  const user = await findUserByVerifiedChannel(value, channelType);
  if (!user) return generic;

  const passwordValid = await verifyPassword(String(user.id), password);
  if (!passwordValid) return generic;

  const approved = await userHasVerifiedChannel(String(user.id));
  if (!approved) return generic;

  if (!user.twoFactorEnabled) {
    // Nothing to fall back to — normal login works.
    return generic;
  }

  const guard = await communicationGuard({
    ownerId: String(user.id),
    ownerType: "user",
    actionKey: "auth.action.loginFallback",
    // `identifier` is public (user submitted it); `stayLoggedIn` is a plain
    // boolean flag. No password / hash is stored in the payload per §5.1.5.
    payload: { identifier: value, stayLoggedIn: !!stayLoggedIn },
    tenant: {
      actorId: String(user.id),
      actorType: "user",
    },
  });

  if (!guard.allowed) {
    // Still return generic success.
    return generic;
  }

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes")) || 15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl")) ??
    "http://localhost:3000";
  const confirmationLink = `${baseUrl}/verify?token=${guard.token}`;

  const verifiedTypes = await listVerifiedChannelTypes(String(user.id), "user");
  const defaultChannels = await core.getSetting(
    "auth.communication.defaultChannels",
  );

  await publish("send_communication", {
    channels: channelOrder(verifiedTypes, defaultChannels),
    recipients: [String(user.id)],
    template: "human-confirmation",
    templateData: {
      actionKey: "auth.action.loginFallback",
      confirmationLink,
      occurredAt: new Date().toISOString(),
      expiryMinutes: String(expiryMinutes),
    },
  });

  return generic;
}

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 5 }),
  async (req, ctx) => handler(req, ctx),
);
