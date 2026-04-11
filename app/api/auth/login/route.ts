import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/utils/rate-limiter";
import { findUserByEmail, verifyPassword } from "@/server/db/queries/auth";
import { createSystemToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

export async function POST(req: NextRequest) {
  const core = Core.getInstance();
  await core.ensureLoaded();
  const rateLimitPerMinute = Number(
    core.getSetting("auth.rateLimit.perMinute") || 5,
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
    core.getSetting("auth.twoFactor.enabled") === "true";

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

  const systemToken = await createSystemToken(
    {
      userId: String(user.id),
      email: user.email,
      roles: user.roles,
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
