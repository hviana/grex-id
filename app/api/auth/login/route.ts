import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { findUserByEmail, verifyPassword } from "@/server/db/queries/auth";
import { createTenantToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { getDb, rid } from "@/server/db/connection";
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";

/**
 * Auth rate limit middleware — reads config from Core settings.
 * Falls back to default (5 req/min) when settings are unavailable.
 */
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

async function handler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const core = Core.getInstance();
  const body = await req.json();
  const { password, stayLoggedIn } = body;
  const email = body.email
    ? standardizeField("email", body.email, "user")
    : undefined;

  const emailErrors = validateField("email", email, "user");
  const passwordErrors = validateField("password", password, "user");

  const allErrors = [...emailErrors, ...passwordErrors];
  if (allErrors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: allErrors },
      },
      { status: 400 },
    );
  }

  const user = await findUserByEmail(email!);
  if (!user) {
    return Response.json(
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
    return Response.json(
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
    return Response.json(
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

  // Two-factor authentication check
  const twoFactorGloballyEnabled =
    (await core.getSetting("auth.twoFactor.enabled")) === "true";

  if (twoFactorGloballyEnabled && user.twoFactorEnabled) {
    const { twoFactorCode } = body;
    if (!twoFactorCode) {
      return Response.json(
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

    // Verify TOTP code using otplib (v13 async API)
    if (user.twoFactorSecret) {
      const totp = new TOTP({
        secret: user.twoFactorSecret,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      });
      const result = await totp.verify(twoFactorCode ?? "");
      if (!result.valid) {
        return Response.json(
          {
            success: false,
            error: {
              code: "2FA_INVALID",
              message: "auth.error.twoFactorInvalid",
            },
          },
          { status: 401 },
        );
      }
    }
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

  return Response.json({
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

// Auth routes use compose() with withRateLimit only (§11)
export const POST = compose(withAuthRateLimit(), handler);
