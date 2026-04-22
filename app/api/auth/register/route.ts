import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  createUserWithChannels,
  purgeAbandonedUsers,
} from "@/server/db/queries/auth";
import { findChannelsByTypeAndValue } from "@/server/db/queries/entity-channels";
import { getDb, rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import { communicationGuard } from "@/server/utils/verification-guard";

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

interface SubmittedChannel {
  type: string;
  value: string;
}

function parseChannels(raw: unknown): SubmittedChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = standardizeField(
      t,
      v,
      "entity_channel",
    );
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function handler(
  req: Request,
  _ctx: RequestContext,
): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json();
  const { password, confirmPassword, termsAccepted } = body;

  if (!termsAccepted) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.terms.required"] },
      },
      { status: 400 },
    );
  }

  const name = body.name
    ? standardizeField("name", body.name, "user")
    : undefined;

  const channels = parseChannels(body.channels);
  if (channels.length === 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.channel.required"],
        },
      },
      { status: 400 },
    );
  }

  const validationErrors: string[] = [
    ...validateField("name", name, "user"),
    ...validateField("password", password, "user"),
  ];

  for (const ch of channels) {
    const errs = validateField(ch.type, ch.value, "entity_channel");
    validationErrors.push(...errs);
  }

  if (password !== confirmPassword) {
    validationErrors.push("validation.password.mismatch");
  }

  if (validationErrors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: validationErrors },
      },
      { status: 400 },
    );
  }

  // Conflict check: reject if any channel value matches an existing user
  // channel that is either verified OR pending a non-expired registration
  // confirmation. Purge abandoned accounts before reusing their values.
  const db = await getDb();
  const abandonedOwnerIds = new Set<string>();
  for (const ch of channels) {
    const existing = await findChannelsByTypeAndValue(ch.type, ch.value);
    for (const row of existing) {
      // Resolve the owning user by scanning user.channels (composable rows
      // have no back-pointer — §1.1.10). Only `user`-owned channels conflict
      // with user registration; lead-owned rows are ignored here.
      const ownerResult = await db.query<[{ id: string }[]]>(
        `SELECT id FROM user WHERE channels CONTAINS $cid LIMIT 1`,
        { cid: rid(String(row.id)) },
      );
      const owner = ownerResult[0]?.[0];
      if (!owner) continue;
      if (row.verified) {
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
      const ownerId = String(owner.id);
      const pendingResult = await db.query<[{ c: number }[]]>(
        `SELECT count() AS c FROM verification_request
         WHERE ownerId = $ownerId
           AND actionKey = "auth.action.register"
           AND usedAt IS NONE
           AND expiresAt > time::now()
         GROUP ALL`,
        { ownerId: rid(ownerId) },
      );
      const pending = pendingResult[0]?.[0]?.c ?? 0;
      if (pending > 0) {
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
      abandonedOwnerIds.add(ownerId);
    }
  }

  if (abandonedOwnerIds.size > 0) {
    await purgeAbandonedUsers([...abandonedOwnerIds]);
  }

  const locale = body.locale as string | undefined;
  const systemSlug = body.systemSlug as string | undefined;

  const { user, channelIds } = await createUserWithChannels({
    password,
    name: name!,
    locale: locale || undefined,
    channels,
  });

  const guardResult = await communicationGuard({
    ownerId: user.id,
    ownerType: "user",
    actionKey: "auth.action.register",
    payload: { channelIds },
    tenant: {
      systemSlug,
      actorType: "anonymous",
    },
  });

  if (guardResult.allowed) {
    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        systemSlug,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

    // Channels from the submitted order; fallback handled by the dispatcher
    // when the first one fails.
    const channelOrder = [...new Set(channels.map((c) => c.type))];

    await publish("send_communication", {
      channels: channelOrder,
      recipients: [user.id],
      template: "human-confirmation",
      templateData: {
        actionKey: "auth.action.register",
        confirmationLink,
        occurredAt: new Date().toISOString(),
        actorName: name,
        expiryMinutes: String(expiryMinutes),
        locale,
        systemSlug,
      },
    });
  }

  return Response.json(
    {
      success: true,
      data: { message: "auth.register.success" },
    },
    { status: 201 },
  );
}

export const POST = compose(withAuthRateLimit(), handler);
