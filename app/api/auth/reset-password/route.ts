import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import Core from "@/server/utils/Core";
import {
  findVerificationRequest,
  markVerificationUsed,
  updatePassword,
} from "@/server/db/queries/auth";
import { validateField } from "@/server/utils/field-validator";

async function handler(req: Request, _ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { token, password, confirmPassword } = body;

  if (!token) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.token.required"] },
      },
      { status: 400 },
    );
  }

  const passwordErrors = await validateField("password", password, "user");
  if (passwordErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: passwordErrors } },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.password.mismatch"] },
      },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request || request.actionKey !== "auth.action.passwordReset") {
    return Response.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return Response.json(
      {
        success: false,
        error: { code: "ALREADY_USED", message: "auth.error.linkUsed" },
      },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return Response.json(
      {
        success: false,
        error: { code: "EXPIRED", message: "auth.error.linkExpired" },
      },
      { status: 400 },
    );
  }

  await markVerificationUsed(request.id);
  await updatePassword(request.ownerId, password);

  return Response.json({
    success: true,
    data: { message: "auth.resetPassword.success" },
  });
}

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }),
  handler,
);
