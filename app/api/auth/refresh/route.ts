import { NextRequest, NextResponse } from "next/server";
import { createSystemToken, verifySystemToken } from "@/server/utils/token";
import { findUserByEmail } from "@/server/db/queries/auth";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { systemToken } = body;

  if (!systemToken) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  try {
    const payload = await verifySystemToken(systemToken);
    const user = await findUserByEmail(payload.email);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "auth.error.userNotFound" },
        },
        { status: 401 },
      );
    }

    const newSystemToken = await createSystemToken(
      {
        userId: String(user.id),
        email: user.email,
        roles: user.roles,
        companyId: payload.companyId,
        systemId: payload.systemId,
        permissions: payload.permissions,
      },
      user.stayLoggedIn,
    );

    const { passwordHash: _, twoFactorSecret: _s, ...safeUser } =
      user as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      data: {
        user: safeUser,
        systemToken: newSystemToken,
        surrealToken: "", // Placeholder until Phase 9
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 401 },
    );
  }
}
