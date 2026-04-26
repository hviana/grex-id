import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { clampPageLimit } from "@/src/lib/validators";
import {
  createTenantAssociations,
  deleteUserWithAdminCheck,
  getUserContext,
  getUsersForTenant,
  getUsersNoTenant,
  hardDeleteUserIfOrphaned,
  inviteExistingUser,
  updateCurrentUserProfile,
  updateUserLocale,
  updateUserProfileName,
  updateUserRolesWithAdminCheck,
} from "@/server/db/queries/users";
import { createUserWithChannels } from "@/server/db/queries/auth";
import { findChannelOwners } from "@/server/db/queries/entity-channels";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";
import { forgetActor } from "@/server/utils/actor-validity";

interface SubmittedChannel {
  type: string;
  value: string;
}

async function parseChannels(raw: unknown): Promise<SubmittedChannel[]> {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = await standardizeField(t, v, "entity_channel");
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "context") {
    if (!ctx.tenant.companyId || !ctx.tenant.systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.companyAndSystem.required",
          },
        },
        { status: 400 },
      );
    }
    const roles = await getUserContext(
      ctx.tenant.actorId!,
      ctx.tenant.id,
    );
    return Response.json({ success: true, data: { roles } });
  }

  const search = url.searchParams.get("search");
  const cursor = url.searchParams.get("cursor");
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  if (ctx.tenant.companyId && ctx.tenant.systemId) {
    const result = await getUsersForTenant({
      tenantId: ctx.tenant.id,
      search: search ?? undefined,
      cursor: cursor ?? undefined,
      limit,
    });
    return Response.json({ success: true, ...result });
  }

  const result = await getUsersNoTenant({
    search: search ?? undefined,
    cursor: cursor ?? undefined,
    limit,
  });
  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { password, name, roles } = body;
  const channels = await parseChannels(body.channels);
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  const stdName = await standardizeField("name", name ?? "", "user");

  const errors: string[] = [...await validateField("name", stdName, "user")];
  if (channels.length === 0) {
    errors.push("validation.channel.required");
  }
  for (const ch of channels) {
    errors.push(...await validateField(ch.type, ch.value, "entity_channel"));
  }
  if (!companyId) {
    errors.push("validation.companyId.required");
  }
  if (!systemId) {
    errors.push("validation.systemId.required");
  }

  if (errors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors } },
      { status: 400 },
    );
  }

  // Try to find an existing user by any submitted channel value. Resolved
  // in a single batched query (§7.2).
  const matches = await findChannelOwners(channels, "user");
  const existingUserId = matches[0]?.ownerId ?? null;

  // Password is only validated for the new-user path. Per AGENTS.md §21.1,
  // the password is silently ignored when inviting an existing user.
  if (!existingUserId) {
    const passwordErrors = await validateField("password", password, "user");
    if (passwordErrors.length > 0) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: passwordErrors },
        },
        { status: 400 },
      );
    }
  }

  if (existingUserId) {
    // Invite flow: associate existing user with the tenant + notify.
    const inviteResult = await inviteExistingUser({
      userId: existingUserId,
      tenantId: ctx.tenant.id,
      roles: roles ?? [],
      inviterId: ctx.tenant.actorId!,
      companyId,
      systemId,
    });

    // Roles changed for the invited user — evict from this tenant's
    // partition so their next request re-authenticates with fresh
    // roles (§8.11).
    await forgetActor(ctx.tenant.id, String(existingUserId));

    const core = Core.getInstance();
    const baseUrl = (await core.getSetting("app.baseUrl", {
      systemId: ctx.tenant.systemId,
    })) ??
      "http://localhost:3000";

    await dispatchCommunication({
      recipients: [existingUserId],
      template: "notification",
      templateData: {
        eventKey: "auth.event.tenantInvite",
        occurredAt: new Date().toISOString(),
        actorName: inviteResult.inviteeName,
        companyName: inviteResult.companyName,
        systemName: inviteResult.systemName,
        resources: (roles ?? []).map((r: string) => `roles.${r}.name`),
        ctaKey: "templates.notification.cta.goToDashboard",
        ctaUrl: `${baseUrl}/login?systemSlug=${ctx.tenant.systemSlug}`,
        systemSlug: ctx.tenant.systemSlug,
        inviterName: inviteResult.inviterName,
      },
    });

    return Response.json(
      { success: true, data: { id: existingUserId }, invited: true },
      { status: 200 },
    );
  }

  // New user — create with channels + register verification.
  const { user, channelIds } = await createUserWithChannels({
    password,
    name: stdName,
    channels,
  });

  await createTenantAssociations({
    userId: String(user.id),
    companyId,
    systemId,
    roles: roles ?? [],
  });

  const guardResult = await communicationGuard({
    ownerId: String(user.id),
    ownerType: "user",
    actionKey: "auth.action.register",
    payload: { channelIds },
    tenant: {
      tenantIds: [ctx.tenant.id],
      systemSlug: ctx.tenant.systemSlug,
    },
  });

  if (guardResult.allowed) {
    const core = Core.getInstance();
    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        { systemId: ctx.tenant.systemId },
      )) || 15,
    );
    const baseUrl = (await core.getSetting("app.baseUrl", {
      systemId: ctx.tenant.systemId,
    })) ??
      "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;
    const channelOrder = [...new Set(channels.map((c) => c.type))];

    await dispatchCommunication({
      channels: channelOrder,
      recipients: [String(user.id)],
      template: "human-confirmation",
      templateData: {
        actionKey: "auth.action.register",
        confirmationLink,
        occurredAt: new Date().toISOString(),
        actorName: stdName,
        expiryMinutes: String(expiryMinutes),
        systemSlug: ctx.tenant.systemSlug,
      },
    });
  }

  return Response.json(
    { success: true, data: user },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "locale") {
    const body = await req.json();
    const locale = body.locale as string | undefined;
    if (!locale || typeof locale !== "string") {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["validation.locale.required"] },
        },
        { status: 400 },
      );
    }

    await updateUserLocale(ctx.tenant.actorId!, locale);
    return Response.json({ success: true });
  }

  if (action === "profile") {
    const body = await req.json();
    const { name, avatarUri, dateOfBirth } = body;
    const userId = ctx.tenant.actorId!;

    let stdName: string | undefined;
    if (name !== undefined) {
      stdName = await standardizeField("name", name, "user");
      const nameErrors = await validateField("name", stdName, "user");
      if (nameErrors.length > 0) {
        return Response.json(
          { success: false, error: { code: "VALIDATION", errors: nameErrors } },
          { status: 400 },
        );
      }
    }

    const updatedUser = await updateCurrentUserProfile({
      userId,
      name: stdName,
      avatarUri,
      dateOfBirth,
    });

    return Response.json({ success: true, data: updatedUser });
  }

  const body = await req.json();
  const { id, name, companyId, systemId, roles } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  if (name !== undefined) {
    const stdName = await standardizeField("name", name, "user");
    await updateUserProfileName(String(id), stdName);
  }

  if (
    roles !== undefined && companyId && systemId
  ) {
    // Resolve the tenantId for the target user's company-system tenant
    // The admin updates roles in the context of their own tenant
    const errorKey = await updateUserRolesWithAdminCheck({
      userId: String(id),
      tenantId: ctx.tenant.id,
      roles,
    });

    if (errorKey) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: [errorKey],
          },
        },
        { status: 400 },
      );
    }

    // Roles changed — evict from this tenant's partition so the user's
    // next request re-authenticates with fresh roles (§8.11).
    await forgetActor(ctx.tenant.id, String(id));
  }

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { userId } = body;

  if (!userId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.fields.required" },
      },
      { status: 400 },
    );
  }

  const errorKey = await deleteUserWithAdminCheck({
    userId: String(userId),
    tenantId: ctx.tenant.id,
  });

  if (errorKey) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: [errorKey],
        },
      },
      { status: 400 },
    );
  }

  // Membership removed — evict the user from this tenant's partition so
  // the user's next request fails at withAuth (§8.11).
  await forgetActor(ctx.tenant.id, String(userId));

  // If the user no longer belongs to any tenant, hard-delete the user
  // and all their compositional data (profile, channels, recovery channels).
  await hardDeleteUserIfOrphaned(String(userId));

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

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
