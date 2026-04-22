import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit } from "@/src/lib/validators";
import { updateUserLocale } from "@/server/db/queries/users";
import { createUserWithChannels } from "@/server/db/queries/auth";
import { findChannelOwners } from "@/server/db/queries/entity-channels";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";

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
    const std = standardizeField(t, v, "entity_channel");
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  if (action === "context") {
    if (!companyId || !systemId) {
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
    const db = await getDb();
    const result = await db.query<[{ roles: string[] }[]]>(
      `SELECT roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
       LIMIT 1`,
      {
        userId: rid(ctx.claims!.actorId),
        companyId: rid(companyId),
        systemId: rid(systemId),
      },
    );
    const roles = result[0]?.[0]?.roles ?? [];
    return Response.json({ success: true, data: { roles } });
  }

  const search = url.searchParams.get("search");
  const cursor = url.searchParams.get("cursor");
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const db = await getDb();
  const bindings: Record<string, unknown> = { limit: limit + 1 };

  if (companyId && systemId) {
    let userQuery = `SELECT id, profile, channels, roles, createdAt,
         (SELECT VALUE roles FROM user_company_system
           WHERE userId = $parent.id AND companyId = $companyId AND systemId = $systemId LIMIT 1)[0] AS contextRoles
       FROM user
       WHERE id IN (SELECT VALUE userId FROM user_company_system
         WHERE companyId = $companyId AND systemId = $systemId)`;
    const userBindings: Record<string, unknown> = {
      companyId: rid(companyId),
      systemId: rid(systemId),
      limit: limit + 1,
    };

    if (search) {
      userQuery += " AND profile.name @@ $search";
      userBindings.search = search;
    }
    if (cursor) {
      userQuery += " AND id > $cursor";
      userBindings.cursor = cursor;
    }

    userQuery +=
      " ORDER BY createdAt DESC LIMIT $limit FETCH profile, channels";

    const result = await db.query<[Record<string, unknown>[]]>(
      userQuery,
      userBindings,
    );
    const items = result[0] ?? [];
    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    return Response.json({
      success: true,
      data,
      nextCursor: hasMore && data.length > 0
        ? (data[data.length - 1] as Record<string, unknown>).id
        : null,
    });
  }

  let query = "SELECT id, profile, channels, roles, createdAt FROM user";
  const conditions: string[] = [];

  if (search) {
    conditions.push("profile.name @@ $search");
    bindings.search = search;
  }
  if (cursor) {
    conditions.push("id > $cursor");
    bindings.cursor = cursor;
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit FETCH profile, channels";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return Response.json({
    success: true,
    data,
    nextCursor: hasMore && data.length > 0
      ? (data[data.length - 1] as Record<string, unknown>).id
      : null,
  });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { password, name, roles } = body;
  const channels = parseChannels(body.channels);
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  const stdName = standardizeField("name", name ?? "", "user");

  const errors: string[] = [...validateField("name", stdName, "user")];
  if (channels.length === 0) {
    errors.push("validation.channel.required");
  }
  for (const ch of channels) {
    errors.push(...validateField(ch.type, ch.value, "entity_channel"));
  }
  if (!companyId || companyId === "0") {
    errors.push("validation.companyId.required");
  }
  if (!systemId || systemId === "0") {
    errors.push("validation.systemId.required");
  }

  if (errors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors } },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Try to find an existing user by any submitted channel value. Resolved
  // in a single batched query (§7.2). entity_channel rows carry no back-
  // pointer (§1.1.10) — the query returns (channel, owner) pairs where the
  // owner's `channels` array references the matching channel id.
  const matches = await findChannelOwners(channels, "user");
  const existingUserId = matches[0]?.ownerId ?? null;

  // Password is only validated for the new-user path. Per AGENTS.md §21.1,
  // the password is silently ignored when inviting an existing user.
  if (!existingUserId) {
    const passwordErrors = validateField("password", password, "user");
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
    const batchResult = await db.query<
      [
        unknown,
        unknown,
        {
          sys: { name: string }[];
          comp: { name: string }[];
          inviter: { profileName?: string }[];
          invitee: { profileName?: string }[];
        },
      ]
    >(
      `IF array::len((SELECT id FROM company_user WHERE companyId = $companyId AND userId = $userId)) = 0 {
         CREATE company_user SET companyId = $companyId, userId = $userId;
       };
       IF array::len((SELECT id FROM user_company_system WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId)) = 0 {
         CREATE user_company_system SET userId = $userId, companyId = $companyId, systemId = $systemId, roles = $roles;
       } ELSE {
         UPDATE user_company_system SET roles = $roles
           WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
       };
       LET $sys = (SELECT name FROM system WHERE id = $systemId LIMIT 1);
       LET $comp = (SELECT name FROM company WHERE id = $companyId LIMIT 1);
       LET $inviter = (SELECT profile.name AS profileName FROM user WHERE id = $inviterId LIMIT 1 FETCH profile);
       LET $invitee = (SELECT profile.name AS profileName FROM user WHERE id = $userId LIMIT 1 FETCH profile);
       RETURN {sys: $sys, comp: $comp, inviter: $inviter, invitee: $invitee};`,
      {
        userId: rid(existingUserId),
        companyId: rid(companyId),
        systemId: rid(systemId),
        roles: roles ?? [],
        inviterId: rid(ctx.claims!.actorId),
      },
    );

    const returnData = batchResult[2];
    const sysName = returnData?.sys?.[0]?.name ?? "";
    const compName = returnData?.comp?.[0]?.name ?? "";
    const inviterName = returnData?.inviter?.[0]?.profileName ?? "";
    const inviteeName = returnData?.invitee?.[0]?.profileName ?? "";

    const core = Core.getInstance();
    const baseUrl =
      (await core.getSetting("app.baseUrl", ctx.tenant.systemSlug)) ??
        "http://localhost:3000";

    await publish("send_communication", {
      recipients: [existingUserId],
      template: "notification",
      templateData: {
        eventKey: "auth.event.tenantInvite",
        occurredAt: new Date().toISOString(),
        actorName: inviteeName,
        companyName: compName,
        systemName: sysName,
        resources: (roles ?? []).map((r: string) => `roles.${r}.name`),
        ctaKey: "templates.notification.cta.goToDashboard",
        ctaUrl: `${baseUrl}/login?system=${ctx.tenant.systemSlug}`,
        systemSlug: ctx.tenant.systemSlug,
        inviterName,
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

  await db.query(
    `CREATE company_user SET companyId = $companyId, userId = $userId;
     CREATE user_company_system SET
       userId = $userId,
       companyId = $companyId,
       systemId = $systemId,
       roles = $roles;`,
    {
      userId: rid(String(user.id)),
      companyId: rid(companyId),
      systemId: rid(systemId),
      roles: roles ?? [],
    },
  );

  const guardResult = await communicationGuard({
    ownerId: String(user.id),
    ownerType: "user",
    actionKey: "auth.action.register",
    payload: { channelIds },
    tenant: {
      companyId,
      systemId,
      systemSlug: ctx.tenant.systemSlug,
      actorId: ctx.claims!.actorId,
      actorType: "user",
    },
  });

  if (guardResult.allowed) {
    const core = Core.getInstance();
    const expiryMinutes = Number(
      (await core.getSetting(
        "auth.communication.expiry.minutes",
        ctx.tenant.systemSlug,
      )) || 15,
    );
    const baseUrl =
      (await core.getSetting("app.baseUrl", ctx.tenant.systemSlug)) ??
        "http://localhost:3000";
    const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;
    const channelOrder = [...new Set(channels.map((c) => c.type))];

    await publish("send_communication", {
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

    await updateUserLocale(ctx.claims!.actorId, locale);
    return Response.json({ success: true });
  }

  if (action === "profile") {
    const body = await req.json();
    const { name, avatarUri, age } = body;
    const userId = ctx.claims!.actorId;
    const db = await getDb();

    const profileSets: string[] = ["updatedAt = time::now()"];
    const profileBindings: Record<string, unknown> = { userId: rid(userId) };

    if (name !== undefined) {
      const stdName = standardizeField("name", name, "user");
      const nameErrors = validateField("name", stdName, "user");
      if (nameErrors.length > 0) {
        return Response.json(
          { success: false, error: { code: "VALIDATION", errors: nameErrors } },
          { status: 400 },
        );
      }
      profileSets.push("name = $name");
      profileBindings.name = stdName;
    }
    if (avatarUri !== undefined) {
      profileSets.push("avatarUri = $avatarUri");
      profileBindings.avatarUri = avatarUri || null;
    }
    if (age !== undefined) {
      profileSets.push("age = $age");
      profileBindings.age = age ? Number(age) : null;
    }

    const stmts = [
      `LET $prof = (SELECT profile FROM user WHERE id = $userId)[0].profile`,
      `UPDATE $prof SET ${profileSets.join(", ")}`,
      `UPDATE $userId SET updatedAt = time::now()`,
      `SELECT * FROM $userId FETCH profile, channels`,
    ];
    const result = await db.query<Record<string, unknown>[][]>(
      stmts.join(";\n"),
      profileBindings,
    );
    const updatedUser = result[result.length - 1]?.[0];

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

  const db = await getDb();

  if (name !== undefined) {
    const stdName = standardizeField("name", name, "user");
    await db.query(
      `LET $prof = (SELECT profile FROM $id);
       UPDATE $prof[0].profile SET name = $name, updatedAt = time::now()`,
      { id: rid(id), name: stdName },
    );
  }

  if (roles !== undefined && companyId && systemId) {
    const res = await db.query(
      `LET $ac = (SELECT count() AS c FROM user_company_system
         WHERE companyId = $companyId AND systemId = $systemId
           AND roles CONTAINS "admin" AND userId != $userId)[0].c;
       IF $ac > 0 OR $roles CONTAINS "admin" {
         UPDATE user_company_system SET roles = $roles
           WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
       };
       RETURN $ac;`,
      {
        userId: rid(id),
        companyId: rid(companyId),
        systemId: rid(systemId),
        roles,
      },
    );
    const otherAdmins = res[2] as number;
    if (otherAdmins === 0 && !roles.includes("admin")) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["users.error.lastAdminRole"],
          },
        },
        { status: 400 },
      );
    }
  }

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { userId, companyId, systemId } = body;

  if (!userId || !companyId || !systemId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.fields.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  const res = await db.query(
    `LET $isTargetAdmin = (SELECT count() AS c FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
         AND roles CONTAINS "admin" LIMIT 1)[0].c;
     LET $ac = (SELECT count() AS c FROM user_company_system
       WHERE companyId = $companyId AND systemId = $systemId
         AND roles CONTAINS "admin" AND userId != $userId)[0].c;
     IF $isTargetAdmin = 0 OR $ac > 0 {
       DELETE user_company_system
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
     };
     RETURN [$isTargetAdmin, $ac];`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );
  const [isTargetAdmin, otherAdmins] = res[3] as [number, number];

  if (isTargetAdmin > 0 && otherAdmins === 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["users.error.lastAdminDelete"],
        },
      },
      { status: 400 },
    );
  }

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
