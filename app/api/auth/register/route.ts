import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  createUserWithChannels,
  purgeAbandonedUsers,
} from "@/server/db/queries/auth";
import {
  findChannelOwners,
  findUsersWithPendingVerification,
} from "@/server/db/queries/entity-channels";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { communicationGuard } from "@/server/utils/verification-guard";
import type { SubmittedChannel } from "@/src/contracts/high-level/channels";

async function parseChannels(raw: unknown): Promise<SubmittedChannel[]> {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = await standardizeField(
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
    ? await standardizeField("name", body.name, "user")
    : undefined;

  const channels = await parseChannels(body.channels);
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
    ...(await validateField("name", name, "user")),
    ...(await validateField("password", password, "user")),
  ];

  for (const ch of channels) {
    const errs = await validateField(ch.type, ch.value, "entity_channel");
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
  // All resolution runs in two batched queries (§7.2):
  //   1. findChannelOwners — (type, value) pairs → matching user-owned channels
  //   2. findUsersWithPendingVerification — those users' pending registrations
  const matches = await findChannelOwners(channels, "user");

  if (matches.some((m) => m.verified)) {
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

  const candidateUserIds = Array.from(new Set(matches.map((m) => m.ownerId)));
  const pendingUserIds = await findUsersWithPendingVerification(
    candidateUserIds,
    "auth.action.register",
  );

  if (pendingUserIds.size > 0) {
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

  // All remaining candidates are abandoned accounts (no verified channel
  // and no pending registration confirmation) — hard-delete them before
  // reusing their channel values.
  if (candidateUserIds.length > 0) {
    await purgeAbandonedUsers(candidateUserIds);
  }

  const locale = body.locale as string | undefined;
  const systemSlug = body.systemSlug as string | undefined;
  const system = systemSlug
    ? await core.getSystemBySlug(systemSlug)
    : undefined;
  const settingScope = system ? { systemId: system.id } : undefined;

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
    payload: {
      changes: channelIds.map((id) => ({
        action: "update" as const,
        actionKey: "auth.action.register",
        entity: "entity_channel",
        id: String(id),
        fields: { verified: true },
      })),
    },
    tenant: {
      systemSlug,
    },
  });

  if (guardResult.allowed) {
    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        settingScope,
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

    // Channels from the submitted order; fallback handled by the dispatcher
    // when the first one fails.
    const channelOrder = [...new Set(channels.map((c) => c.type))];

    await dispatchCommunication({
      channels: channelOrder,
      recipients: [user.id],
      template: "human-confirmation",
      allowUnverified: true,
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

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }),
  handler,
);
