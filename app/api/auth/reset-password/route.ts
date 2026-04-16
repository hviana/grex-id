import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  findVerificationRequest,
  markVerificationUsed,
  updatePassword,
} from "@/server/db/queries/auth";
import { validateField } from "@/server/utils/field-validator";

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

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { token, password, confirmPassword } = body;

  if (!token) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: ["validation.token.required"] } },
      { status: 400 },
    );
  }

  const passwordErrors = validateField("password", password, "user");
  if (passwordErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: passwordErrors } },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: ["validation.password.mismatch"] } },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request || request.type !== "password_reset") {
    return Response.json(
      { success: false, error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" } },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return Response.json(
      { success: false, error: { code: "ALREADY_USED", message: "auth.error.linkUsed" } },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return Response.json(
      { success: false, error: { code: "EXPIRED", message: "auth.error.linkExpired" } },
      { status: 400 },
    );
  }

  await markVerificationUsed(request.id);
  await updatePassword(request.userId, password);

  return Response.json({
    success: true,
    data: { message: "auth.resetPassword.success" },
  });
}

export const POST = compose(withAuthRateLimit(), handler);
