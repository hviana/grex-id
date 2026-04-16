import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit } from "@/src/lib/validators";
import { verifyTenantToken } from "@/server/utils/token";
import { updateUserLocale } from "@/server/db/queries/users";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const companyId = url.searchParams.get("companyId");
  const systemId = url.searchParams.get("systemId");

  // Return the authenticated user's roles for a specific company+system
  if (action === "context") {
    if (!companyId || !systemId) {
      return NextResponse.json(
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
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "AUTH", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }
    try {
      const payload = await verifyTenantToken(token);
      const db = await getDb();
      const result = await db.query<[{ roles: string[] }[]]>(
        `SELECT roles FROM user_company_system
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
         LIMIT 1`,
        {
          userId: rid(payload.actorId),
          companyId: rid(companyId),
          systemId: rid(systemId),
        },
      );
      const roles = result[0]?.[0]?.roles ?? [];
      return NextResponse.json({ success: true, data: { roles } });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: "AUTH", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }
  }

  const search = url.searchParams.get("search");
  const cursor = url.searchParams.get("cursor");
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const db = await getDb();
  const bindings: Record<string, unknown> = { limit: limit + 1 };

  // If companyId+systemId provided, filter by user_company_system association
  if (companyId && systemId) {
    let query =
      `SELECT userId AS id FROM user_company_system WHERE companyId = $companyId AND systemId = $systemId`;
    bindings.companyId = rid(companyId);
    bindings.systemId = rid(systemId);
    const ucsResult = await db.query<[{ id: string }[]]>(query, bindings);
    const userIds = (ucsResult[0] ?? []).map((u) => u.id);

    if (userIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        nextCursor: null,
      });
    }

    let userQuery =
      "SELECT id, email, emailVerified, phone, profile, roles, createdAt FROM user WHERE id IN $userIds";
    const userBindings: Record<string, unknown> = {
      userIds: userIds.map((id) => rid(id)),
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

    // Attach context roles from user_company_system
    const rolesQuery = await db.query<[{ userId: string; roles: string[] }[]]>(
      `SELECT userId, roles FROM user_company_system
       WHERE companyId = $companyId AND systemId = $systemId AND userId IN $userIds`,
      {
        companyId: rid(companyId),
        systemId: rid(systemId),
        userIds: userIds.map((id) => rid(id)),
      },
    );
    const rolesMap = new Map<string, string[]>();
    for (const r of rolesQuery[0] ?? []) {
      rolesMap.set(String(r.userId), r.roles ?? []);
    }
    for (const item of data) {
      (item as Record<string, unknown>).contextRoles =
        rolesMap.get(String(item.id)) ?? [];
    }

    return NextResponse.json({
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

  return NextResponse.json({
    success: true,
    data,
    nextCursor: hasMore && data.length > 0
      ? (data[data.length - 1] as Record<string, unknown>).id
      : null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, phone, password, name, companyId, systemId, roles } = body;

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
  if (!companyId) errors.push("validation.companyId.required");
  if (!systemId) errors.push("validation.systemId.required");

  if (errors.length > 0) {
    return NextResponse.json(
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
    await db.query(
      `IF array::len((SELECT id FROM company_user WHERE companyId = $companyId AND userId = $userId)) = 0 {
         CREATE company_user SET companyId = $companyId, userId = $userId;
       };
       IF array::len((SELECT id FROM user_company_system WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId)) = 0 {
         CREATE user_company_system SET userId = $userId, companyId = $companyId, systemId = $systemId, roles = $roles;
       } ELSE {
         UPDATE user_company_system SET roles = $roles
           WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
       };`,
      {
        userId: rid(String(existingUser.id)),
        companyId: rid(companyId),
        systemId: rid(systemId),
        roles: roles ?? [],
      },
    );
    return NextResponse.json(
      { success: true, data: existingUser, invited: true },
      { status: 200 },
    );
  }

  // New user — create with profile, then associate
  const result = await db.query<
    [unknown, unknown, unknown, unknown, Record<string, unknown>[]]
  >(
    `LET $prof = CREATE profile SET name = $name;
     LET $usr = CREATE user SET
       email = $email,
       phone = $phone,
       passwordHash = crypto::argon2::generate($password),
       profile = $prof[0].id,
       roles = [],
       emailVerified = true;
     CREATE company_user SET companyId = $companyId, userId = $usr[0].id;
     CREATE user_company_system SET
       userId = $usr[0].id,
       companyId = $companyId,
       systemId = $systemId,
       roles = $roles;
     SELECT * FROM $usr[0].id FETCH profile;`,
    {
      name: stdName,
      email: stdEmail,
      phone: stdPhone,
      password,
      companyId: rid(companyId),
      systemId: rid(systemId),
      roles: roles ?? [],
    },
  );

  return NextResponse.json(
    { success: true, data: result[4]?.[0] },
    { status: 201 },
  );
}

export async function PUT(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "locale") {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }
    let tokenPayload;
    try {
      tokenPayload = await verifyTenantToken(authHeader.slice(7));
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }

    const body = await req.json();
    const locale = body.locale as string | undefined;
    if (!locale || typeof locale !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["validation.locale.required"] },
        },
        { status: 400 },
      );
    }

    await updateUserLocale(tokenPayload.actorId as string, locale);
    return NextResponse.json({ success: true });
  }

  // Self-service profile update (authenticated user updates their own profile)
  if (action === "profile") {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }
    let tokenPayload;
    try {
      tokenPayload = await verifyTenantToken(authHeader.slice(7));
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { name, phone, avatarUri, age } = body;
    const userId = tokenPayload.actorId;
    const db = await getDb();

    const profileSets: string[] = ["updatedAt = time::now()"];
    const profileBindings: Record<string, unknown> = { userId: rid(userId) };

    if (name !== undefined) {
      const stdName = standardizeField("name", name, "user");
      const nameErrors = validateField("name", stdName, "user");
      if (nameErrors.length > 0) {
        return NextResponse.json(
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
          return NextResponse.json(
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

    // Single batched query: update profile + user fields + return updated user
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

    return NextResponse.json({ success: true, data: updatedUser });
  }

  // Edit user profile + roles (admin)
  const body = await req.json();
  const { id, name, phone, companyId, systemId, roles } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (name !== undefined) {
    const stdName = standardizeField("name", name, "user");
    // Update profile.name via the profile record
    await db.query(
      `LET $prof = (SELECT profile FROM $id);
       UPDATE $prof[0].profile SET name = $name, updatedAt = time::now();`,
      { id: rid(id), name: stdName },
    );
  }

  if (phone !== undefined) {
    const stdPhone = phone ? standardizeField("phone", phone, "user") : null;
    sets.push("phone = $phone");
    bindings.phone = stdPhone;
  }

  if (sets.length > 0) {
    await db.query(
      `UPDATE $id SET ${sets.join(", ")}, updatedAt = time::now()`,
      bindings,
    );
  }

  // Update context roles
  if (roles !== undefined && companyId && systemId) {
    await db.query(
      `UPDATE user_company_system SET roles = $roles
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId`,
      {
        userId: rid(id),
        companyId: rid(companyId),
        systemId: rid(systemId),
        roles,
      },
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { userId, companyId, systemId } = body;

  if (!userId || !companyId || !systemId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.fields.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Remove user_company_system association (NOT the user record)
  await db.query(
    `DELETE user_company_system
     WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );

  return NextResponse.json({ success: true });
}
