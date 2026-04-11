import { NextRequest, NextResponse } from "next/server";
import {
  findVerificationRequest,
  markVerificationUsed,
  updatePassword,
} from "@/server/db/queries/auth";
import { validateField } from "@/server/utils/field-validator";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, password, confirmPassword } = body;

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.token.required"] },
      },
      { status: 400 },
    );
  }

  const passwordErrors = validateField("password", password, "user");
  if (passwordErrors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: passwordErrors },
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

  const request = await findVerificationRequest(token);
  if (!request || request.type !== "password_reset") {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "auth.error.invalidToken",
        },
      },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ALREADY_USED",
          message: "auth.error.linkUsed",
        },
      },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "EXPIRED", message: "auth.error.linkExpired" },
      },
      { status: 400 },
    );
  }

  await markVerificationUsed(request.id);
  await updatePassword(request.userId, password);

  return NextResponse.json({
    success: true,
    data: { message: "auth.resetPassword.success" },
  });
}
