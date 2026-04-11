import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/utils/rate-limiter";
import {
  createUser,
  createVerificationRequest,
} from "@/server/db/queries/auth";
import { generateSecureToken } from "@/server/utils/token";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";

export async function POST(req: NextRequest) {
  const core = Core.getInstance();
  const rateLimitPerMinute = Number(
    await core.getSetting("auth.rateLimit.perMinute"),
  );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = checkRateLimit(`ip:${ip}:register`, {
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
  const { password, confirmPassword, termsAccepted } = body;

  if (!termsAccepted) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.terms.required"] },
      },
      { status: 400 },
    );
  }
  const email = body.email
    ? standardizeField("email", body.email, "user")
    : undefined;
  const name = body.name
    ? standardizeField("name", body.name, "user")
    : undefined;
  const phone = body.phone
    ? standardizeField("phone", body.phone, "user")
    : undefined;

  const emailErrors = validateField("email", email, "user");
  const nameErrors = validateField("name", name, "user");
  const passwordErrors = validateField("password", password, "user");

  const allErrors = [
    ...emailErrors,
    ...nameErrors,
    ...passwordErrors,
  ];

  if (allErrors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: allErrors },
      },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.password.mismatch"],
        },
      },
      { status: 400 },
    );
  }

  const dup = await checkDuplicates("user", [
    { field: "email", value: email },
    { field: "phone", value: phone ?? null },
  ]);
  if (dup.isDuplicate) {
    const conflictErrors = dup.conflicts.map((c) =>
      `validation.${c.field}.duplicate`
    );
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CONFLICT",
          errors: conflictErrors,
        },
      },
      { status: 409 },
    );
  }

  const locale = body.locale as string | undefined;

  const user = await createUser({
    email: email!,
    password,
    name: name!,
    phone: phone || undefined,
    locale: locale || undefined,
  });

  const verificationExpiryMinutes = Number(
    await core.getSetting("auth.verification.expiry.minutes"),
  );

  const verificationToken = generateSecureToken();
  await createVerificationRequest({
    userId: user.id,
    type: "email_verify",
    token: verificationToken,
    expiresAt: new Date(Date.now() + verificationExpiryMinutes * 60_000),
  });

  const baseUrl = (await core.getSetting("app.baseUrl")) ??
    "http://localhost:3000";
  const verificationLink = `${baseUrl}/verify?token=${verificationToken}`;
  const systemSlug = body.systemSlug as string | undefined;

  await publish("SEND_EMAIL", {
    recipients: [email!],
    template: "verification",
    templateData: { name: name!, verificationLink },
    locale,
    systemSlug,
  });

  return NextResponse.json(
    {
      success: true,
      data: { message: "auth.register.success" },
    },
    { status: 201 },
  );
}
