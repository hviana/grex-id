import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
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
  const { password, confirmPassword, termsAccepted } = body;

  if (!termsAccepted) {
    return Response.json(
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
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: allErrors },
      },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return Response.json(
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
    return Response.json(
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

  return Response.json(
    {
      success: true,
      data: { message: "auth.register.success" },
    },
    { status: 201 },
  );
}

export const POST = compose(withAuthRateLimit(), handler);
