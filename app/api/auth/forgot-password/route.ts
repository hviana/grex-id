import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/utils/rate-limiter";
import {
  createVerificationRequest,
  findUserByEmail,
  getLastVerificationRequest,
} from "@/server/db/queries/auth";
import { generateSecureToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";

export async function POST(req: NextRequest) {
  const core = Core.getInstance();
  await core.ensureLoaded();
  const rateLimitPerMinute = Number(
    core.getSetting("auth.rateLimit.perMinute"),
  );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = checkRateLimit(`ip:${ip}:forgot`, {
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
  const email = body.email
    ? standardizeField("email", body.email, "user")
    : undefined;

  // Always return success to avoid user enumeration
  const successResponse = NextResponse.json({
    success: true,
    data: {
      message: "auth.forgotPassword.success",
    },
  });

  const emailErrors = validateField("email", email, "user");
  if (emailErrors.length > 0) {
    return successResponse;
  }

  const user = await findUserByEmail(email!);
  if (!user) return successResponse;

  const cooldownSeconds = Number(
    core.getSetting("auth.verification.cooldown.seconds"),
  );

  // Check cooldown
  const lastRequest = await getLastVerificationRequest(
    user.id,
    "password_reset",
  );
  if (lastRequest) {
    const elapsed = Date.now() - new Date(lastRequest.createdAt).getTime();
    if (elapsed < cooldownSeconds * 1000) {
      return successResponse;
    }
  }

  const resetExpiryMinutes = Number(
    core.getSetting("auth.passwordReset.expiry.minutes"),
  );

  const resetToken = generateSecureToken();
  await createVerificationRequest({
    userId: user.id,
    type: "password_reset",
    token: resetToken,
    expiresAt: new Date(Date.now() + resetExpiryMinutes * 60_000),
  });

  const baseUrl = core.getSetting("app.baseUrl") ?? "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  const systemSlug = body.systemSlug as string | undefined;

  await publish("SEND_EMAIL", {
    recipients: [email!],
    template: "password-reset",
    templateData: { name: user.profile?.name ?? email!, resetLink },
    locale: user.profile?.locale || undefined,
    systemSlug,
  });

  return successResponse;
}
