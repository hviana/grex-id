import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit } from "@/src/lib/validators";
import { updateUserLocale } from "@/server/db/queries/users";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import Core from "@/server/utils/Core";
import { generateSecureToken } from "@/server/utils/token";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  // Return the authenticated user's roles for a specific company+system
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

  // If companyId+systemId provided, filter by user_company_system association
  if (companyId && systemId) {
    // Single query: fetch user IDs with inline contextRoles via subquery (§7.2, §1.9)
    let userQuery =
      `SELECT id, email, emailVerified, phone, profile, roles, createdAt,
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

    userQuery += " ORDER BY createdAt DESC LIMIT $limit FETCH profile";

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

  // Fallback: list all users (original behavior)
  let query =
    "SELECT id, email, emailVerified, phone, profile, roles, createdAt FROM user";
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
  query += " ORDER BY createdAt DESC LIMIT $limit FETCH profile";

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
  const { email, phone, password, name, roles } = body;
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  // Standardize
  const stdEmail = standardizeField("email", email ?? "", "user");
  const stdPhone = phone ? standardizeField("phone", phone, "user") : undefined;
  const stdName = standardizeField("name", name ?? "", "user");

  // Validate
  const errors: string[] = [
    ...validateField("email", stdEmail, "user"),
    ...validateField("password", password, "user"),
    ...validateField("name", stdName, "user"),
  ];
  if (stdPhone) errors.push(...validateField("phone", stdPhone, "user"));
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

  // Check if user already exists (invite flow: associate without creating)
  const existingResult = await db.query<[Record<string, unknown>[]]>(
    `SELECT id, email, phone, profile, roles FROM user WHERE email = $email LIMIT 1 FETCH profile`,
    { email: stdEmail },
  );
  const existingUser = existingResult[0]?.[0];

  if (existingUser) {
    // User already exists — invite them to this company+system
    // Batch: association creation + inviter/system/company lookups in one query (§7.2, §1.6)
    const batchResult = await db.query<
      [
        unknown,
        unknown,
        {
          sys: { name: string }[];
          comp: { name: string }[];
          inviter: { email: string; profileName: string }[];
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
       LET $inviter = (SELECT email, profile.name AS profileName FROM user WHERE id = $inviterId LIMIT 1 FETCH profile);
       RETURN {sys: $sys, comp: $comp, inviter: $inviter};`,
      {
        userId: rid(String(existingUser.id)),
        companyId: rid(companyId),
        systemId: rid(systemId),
        roles: roles ?? [],
        inviterId: rid(ctx.claims!.actorId),
      },
    );

    const returnData = batchResult[2] as {
      sys: { name: string }[];
      comp: { name: string }[];
      inviter: { email: string; profileName: string }[];
    } | undefined;
    const sysName = returnData?.sys?.[0]?.name ?? "";
    const compName = returnData?.comp?.[0]?.name ?? "";
    const inviterName = returnData?.inviter?.[0]?.profileName ??
      returnData?.inviter?.[0]?.email ?? "";

    const core = Core.getInstance();
    const baseUrl =
      (await core.getSetting("app.baseUrl", ctx.tenant.systemSlug)) ??
        "http://localhost:3000";

    await publish("SEND_EMAIL", {
      recipients: [stdEmail],
      template: "tenant-invite",
      templateData: {
        name: (existingUser as any).profile?.name ?? stdEmail,
        inviterName,
        companyName: compName,
        systemName: sysName,
        roles: (roles ?? []).join(", "),
        loginUrl: `${baseUrl}/login?system=${ctx.tenant.systemSlug}`,
      },
      locale: undefined,
      systemSlug: ctx.tenant.systemSlug,
    });

    return Response.json(
      { success: true, data: existingUser, invited: true },
      { status: 200 },
    );
  }

  // New user — create with profile, then associate (§19.3: emailVerified = false)
  const verifyToken = generateSecureToken();
  const core = Core.getInstance();
  const expiryMinutes = Number(
    (await core.getSetting(
      "auth.verification.expiry.minutes",
      ctx.tenant.systemSlug,
    )) ?? "15",
  );
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  const baseUrl =
    (await core.getSetting("app.baseUrl", ctx.tenant.systemSlug)) ??
      "http://localhost:3000";

  const result = await db.query<
    [unknown, unknown, unknown, unknown, unknown, Record<string, unknown>[]]
  >(
    `LET $prof = CREATE profile SET name = $name;
     LET $usr = CREATE user SET
       email = $email,
       phone = $phone,
       passwordHash = crypto::argon2::generate($password),
       profile = $prof[0].id,
       roles = [],
       emailVerified = false;
     CREATE company_user SET companyId = $companyId, userId = $usr[0].id;
     CREATE user_company_system SET
       userId = $usr[0].id,
       companyId = $companyId,
       systemId = $systemId,
       roles = $roles;
     CREATE verification_request SET
       type = "email_verify",
       userId = $usr[0].id,
       token = $verifyToken,
       expiresAt = $expiresAt;
     SELECT * FROM $usr[0].id FETCH profile;`,
    {
      name: stdName,
      email: stdEmail,
      phone: stdPhone,
      password,
      companyId: rid(companyId),
      systemId: rid(systemId),
      roles: roles ?? [],
      verifyToken,
      expiresAt,
    },
  );

  const newUser = result[5]?.[0];
  const verificationLink = `${baseUrl}/verify?token=${verifyToken}&email=${
    encodeURIComponent(stdEmail)
  }`;

  await publish("SEND_EMAIL", {
    recipients: [stdEmail],
    template: "verification",
    templateData: {
      name: stdName,
      verificationLink,
      email: stdEmail,
      expiryMinutes: String(expiryMinutes),
    },
    locale: undefined,
    systemSlug: ctx.tenant.systemSlug,
  });

  return Response.json(
    { success: true, data: newUser },
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

  // Self-service profile update (authenticated user updates their own profile)
  if (action === "profile") {
    const body = await req.json();
    const { name, phone, avatarUri, age } = body;
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

    const userSets: string[] = ["updatedAt = time::now()"];
    const userBindings: Record<string, unknown> = { userId: rid(userId) };

    if (phone !== undefined) {
      const stdPhone = phone ? standardizeField("phone", phone, "user") : null;
      if (stdPhone) {
        const phoneErrors = validateField("phone", stdPhone, "user");
        if (phoneErrors.length > 0) {
          return Response.json(
            {
              success: false,
              error: { code: "VALIDATION", errors: phoneErrors },
            },
            { status: 400 },
          );
        }
      }
      userSets.push("phone = $phone");
      userBindings.phone = stdPhone;
    }

    // Single batched query: update profile + user fields + return updated user (§7.2)
    const stmts = [
      `LET $prof = (SELECT profile FROM user WHERE id = $userId)[0].profile`,
      `UPDATE $prof SET ${profileSets.join(", ")}`,
      ...(userSets.length > 1
        ? [`UPDATE $userId SET ${userSets.join(", ")}`]
        : []),
      `SELECT * FROM $userId FETCH profile`,
    ];
    const result = await db.query<Record<string, unknown>[][]>(
      stmts.join(";\n"),
      { ...profileBindings, ...userBindings },
    );
    const updatedUser = result[result.length - 1]?.[0];

    return Response.json({ success: true, data: updatedUser });
  }

  // Edit user profile + roles (admin)
  const body = await req.json();
  const { id, name, phone, companyId, systemId, roles } = body;

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

  // Batch profile + user updates into one query (§7.2, §1.8)
  const stmts: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (name !== undefined) {
    const stdName = standardizeField("name", name, "user");
    bindings.name = stdName;
    stmts.push(
      `LET $prof = (SELECT profile FROM $id);
       UPDATE $prof[0].profile SET name = $name, updatedAt = time::now()`,
    );
  }

  if (phone !== undefined) {
    const stdPhone = phone ? standardizeField("phone", phone, "user") : null;
    bindings.phone = stdPhone;
    stmts.push(`UPDATE $id SET phone = $phone, updatedAt = time::now()`);
  }

  if (stmts.length > 0) {
    await db.query(stmts.join("; "), bindings);
  }

  // Update context roles — enforce admin invariant (§21.1, §7.2)
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

async function deleteHandler(req: Request, ctx: RequestContext) {
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

  // Admin invariant (§21.1): atomic check + delete in single batched query (§7.2)
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
