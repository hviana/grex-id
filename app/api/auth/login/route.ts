import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/utils/rate-limiter";
import { findUserByEmail, verifyPassword } from "@/server/db/queries/auth";
import { createTenantToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { getDb, rid } from "@/server/db/connection";

export async function POST(req: NextRequest) {
  const core = Core.getInstance();
  const rateLimitPerMinute = Number(
    (await core.getSetting("auth.rateLimit.perMinute")) || 5,
  );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = checkRateLimit(`ip:${ip}:login`, {
    windowMs: 60_000,
    maxRequests: rateLimitPerMinute,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "RATE_LIMITED", message: "common.error.rateLimited" },
      },
      { status: 429 },
    );
  }

  const body = await req.json();
  const { password, stayLoggedIn } = body;
  const email = body.email
    ? standardizeField("email", body.email, "user")
    : undefined;

  const emailErrors = validateField("email", email, "user");
  const passwordErrors = validateField("password", password, "user");

  const allErrors = [...emailErrors, ...passwordErrors];
  if (allErrors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: allErrors },
      },
      { status: 400 },
    );
  }

  const user = await findUserByEmail(email!);
  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "auth.error.invalidCredentials",
        },
      },
      { status: 401 },
    );
  }

  const passwordValid = await verifyPassword(email!, password);
  if (!passwordValid) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "auth.error.invalidCredentials",
        },
      },
      { status: 401 },
    );
  }

  if (!user.emailVerified) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "NOT_VERIFIED",
          message: "auth.error.notVerified",
        },
      },
      { status: 403 },
    );
  }

  const twoFactorGloballyEnabled =
    (await core.getSetting("auth.twoFactor.enabled")) === "true";

  if (twoFactorGloballyEnabled && user.twoFactorEnabled) {
    const { twoFactorCode } = body;
    if (!twoFactorCode) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "2FA_REQUIRED",
            message: "auth.error.twoFactorRequired",
          },
        },
        { status: 403 },
      );
    }
    // TODO: Verify TOTP code against user.twoFactorSecret
  }

  // Resolve the user's first company+system membership for the initial tenant
  const db = await getDb();
  const membership = await db.query<
    [{
      companyId: string;
      systemId: string;
      systemSlug: string;
      roles: string[];
      permissions: string[];
    }[]]
  >(
    `LET $ucs = (SELECT companyId, systemId FROM user_company_system WHERE userId = $userId LIMIT 1);
     IF array::len($ucs) > 0 {
       LET $sys = (SELECT slug FROM system WHERE id = $ucs[0].systemId LIMIT 1);
       LET $roleRecs = (SELECT permissions FROM role WHERE systemId = $ucs[0].systemId AND id IN (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles);
       SELECT
         $ucs[0].companyId AS companyId,
         $ucs[0].systemId AS systemId,
         $sys[0].slug AS systemSlug,
         (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles AS roles,
         math::flat($roleRecs[*].permissions) AS permissions
       FROM system WHERE id = $ucs[0].systemId LIMIT 1;
     } ELSE {
       SELECT "0" AS companyId, "0" AS systemId, "core" AS systemSlug, [] AS roles, [] AS permissions SKIP 0 LIMIT 0;
     };`,
    { userId: rid(String(user.id)) },
  );

  const mem = membership[0]?.[0];
  const tenant = mem
    ? {
      systemId: String(mem.systemId),
      companyId: String(mem.companyId),
      systemSlug: mem.systemSlug ?? "core",
      roles: (mem.roles ?? []) as string[],
      permissions: (mem.permissions ?? []) as string[],
    }
    : {
      systemId: "0",
      companyId: "0",
      systemSlug: "core",
      roles: [] as string[],
      permissions: [] as string[],
    };

  // Superuser detection from user.roles (global)
  const isSuperuser = (user.roles ?? []).includes("superuser");
  if (isSuperuser) {
    tenant.roles = ["superuser"];
    tenant.permissions = ["*"];
  }

  const jti = crypto.randomUUID();
  const systemToken = await createTenantToken(
    {
      ...tenant,
      actorType: "user",
      actorId: String(user.id),
      jti,
      exchangeable: true,
    },
    stayLoggedIn ?? false,
  );

  // TODO: Issue SurrealDB user token for frontend WebSocket (Phase 9)

  return NextResponse.json({
    success: true,
    data: {
      systemToken,
      surrealToken: "", // Placeholder until Phase 9
      user: {
        id: user.id,
        email: user.email,
        profile: user.profile,
        roles: user.roles,
      },
    },
  });
}
