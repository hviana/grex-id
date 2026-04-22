import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  findUserByVerifiedChannel,
  userHasVerifiedChannel,
  verifyPassword,
} from "@/server/db/queries/auth";
import { createTenantToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { getDb, rid } from "@/server/db/connection";
import { NobleCryptoPlugin, ScureBase32Plugin, TOTP } from "otplib";

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

function guessChannelType(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return "phone";
  return undefined;
}

async function handler(
  req: Request,
  _ctx: RequestContext,
): Promise<Response> {
  const body = await req.json();
  const { password, stayLoggedIn, identifier, twoFactorCode } = body as {
    password?: string;
    stayLoggedIn?: boolean;
    identifier?: string;
    twoFactorCode?: string;
  };
  // Backwards-compat: older frontends send `email` instead of `identifier`.
  const raw = identifier ?? (body as { email?: string }).email;

  if (!raw || typeof raw !== "string" || !password) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.identifier.required"],
        },
      },
      { status: 400 },
    );
  }

  const channelType = guessChannelType(raw);
  const value = channelType
    ? standardizeField(channelType, raw, "entity_channel")
    : raw.trim();

  const user = await findUserByVerifiedChannel(value, channelType);
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

  const passwordValid = await verifyPassword(String(user.id), password);
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

  const approved = await userHasVerifiedChannel(String(user.id));
  if (!approved) {
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

  // Second-factor gate — per-user only (§19.15). No global toggle.
  if (user.twoFactorEnabled) {
    if (!twoFactorCode) {
      // Client should either collect a TOTP code or call
      // POST /api/auth/two-factor/login-link to receive the channel fallback.
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

    if (user.twoFactorSecret) {
      const totp = new TOTP({
        secret: user.twoFactorSecret,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      });
      const result = await totp.verify(twoFactorCode);
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
    } else {
      // twoFactorEnabled without a stored secret is an inconsistent state.
      // Reject instead of silently letting the user in.
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
         array::flatten($roleRecs[*].permissions) AS permissions
       FROM system WHERE id = $ucs[0].systemId LIMIT 1;
     } ELSE {
       RETURN [];
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
  return Response.json({
    success: true,
    data: {
      systemToken,
      user: {
        id: user.id,
        profile: user.profile,
        roles: user.roles,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
      },
    },
  });
}

export const POST = compose(withAuthRateLimit(), handler);
