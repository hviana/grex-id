import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { findUserByEmail } from "@/server/db/queries/auth";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { publish } from "@/server/event-queue/publisher";
import { communicationGuard } from "@/server/utils/verification-guard";

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
  const systemSlug = body.systemSlug as string | undefined;
  const email = body.email
    ? standardizeField("email", body.email, "user")
    : undefined;

  // Always return success to avoid user enumeration
  const successResponse = Response.json({
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

  const guardResult = await communicationGuard({
    userId: user.id,
    type: "password_reset",
    systemSlug,
  });

  if (!guardResult.allowed) return successResponse;

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
    "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${guardResult.token}`;

  await publish("SEND_EMAIL", {
    recipients: [email!],
    template: "password-reset",
    templateData: {
      name: user.profile?.name ?? email!,
      resetLink,
      email: email!,
      expiryMinutes: String(expiryMinutes),
    },
    locale: user.profile?.locale || undefined,
    systemSlug,
  });

  return successResponse;
}

export const POST = compose(withAuthRateLimit(), handler);
