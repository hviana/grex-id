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

  const successResponse = Response.json({
    success: true,
    data: {
      message: "auth.verify.resent",
    },
  });

  const emailErrors = validateField("email", email, "user");
  if (emailErrors.length > 0) {
    return successResponse;
  }

  const user = await findUserByEmail(email!);
  if (!user || user.emailVerified) {
    return successResponse;
  }

  const guardResult = await communicationGuard({
    userId: user.id,
    type: "email_verify",
    systemSlug,
  });

  if (!guardResult.allowed) {
    return successResponse;
  }

  const expiryMinutes = Number(
    (await core.getSetting("auth.communication.expiry.minutes", systemSlug)) ||
      15,
  );
  const baseUrl = (await core.getSetting("app.baseUrl", systemSlug)) ??
    "http://localhost:3000";
  const verifyParams = new URLSearchParams({ token: guardResult.token! });
  if (systemSlug) {
    verifyParams.set("system", systemSlug);
  }

  await publish("SEND_EMAIL", {
    recipients: [user.email],
    template: "verification",
    templateData: {
      name: user.profile?.name ?? user.email,
      verificationLink: `${baseUrl}/verify?${verifyParams.toString()}`,
      email: user.email,
      expiryMinutes: String(expiryMinutes),
    },
    locale: user.profile?.locale || undefined,
    systemSlug,
  });

  return successResponse;
}

export const POST = compose(withAuthRateLimit(), handler);
