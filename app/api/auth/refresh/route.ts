import { NextRequest, NextResponse } from "next/server";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import { isJtiRevoked } from "@/server/utils/token-revocation";
import { getDb, rid } from "@/server/db/connection";

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
    const claims = await verifyTenantToken(systemToken);

    // Check if token has been revoked
    if (claims.jti && (await isJtiRevoked(claims.jti))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    // Verify user still exists
    const db = await getDb();
    const userResult = await db.query<
      [{ id: string; email: string; stayLoggedIn: boolean }[]]
    >(
      `SELECT id, email, stayLoggedIn FROM user WHERE id = $userId LIMIT 1`,
      { userId: rid(claims.actorId) },
    );

    const user = userResult[0]?.[0];
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "auth.error.userNotFound" },
        },
        { status: 401 },
      );
    }

    // For user tokens, re-resolve roles/permissions from current membership
    let updatedClaims = claims;
    if (claims.actorType === "user" && claims.systemId !== "0") {
      const membership = await db.query<
        [{ roles: string[] }[]]
      >(
        `SELECT roles FROM user_company_system
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
         LIMIT 1`,
        {
          userId: rid(claims.actorId),
          companyId: rid(claims.companyId),
          systemId: rid(claims.systemId),
        },
      );

      const currentRoles = membership[0]?.[0]?.roles ?? claims.roles;

      // Check if user is superuser
      const superuserCheck = await db.query<[{ roles: string[] }[]]>(
        `SELECT roles FROM user WHERE id = $userId LIMIT 1`,
        { userId: rid(claims.actorId) },
      );
      const isSuperuser = (superuserCheck[0]?.[0]?.roles ?? []).includes(
        "superuser",
      );

      if (isSuperuser) {
        updatedClaims = {
          ...claims,
          roles: ["superuser"],
          permissions: ["*"],
        };
      } else {
        // Refresh roles from DB
        const ucs = await db.query<[{ roles: string[] }[]]>(
          `SELECT roles FROM user_company_system
           WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
           LIMIT 1`,
          {
            userId: rid(claims.actorId),
            companyId: rid(claims.companyId),
            systemId: rid(claims.systemId),
          },
        );
        const roles = ucs[0]?.[0]?.roles ?? claims.roles;

        const rolePerms = await db.query<[{ permissions: string[] }[]]>(
          `SELECT permissions FROM role WHERE id IN $roles`,
          { roles: roles.map((r: string) => rid(r)) },
        );
        const permissions = [
          ...new Set(
            rolePerms[0]?.flatMap((r) => r.permissions ?? []) ?? [],
          ),
        ];

        updatedClaims = {
          ...claims,
          roles,
          permissions,
        };
      }
    }

    // Issue new token with same tenant but fresh expiry
    const newJti = crypto.randomUUID();
    const newToken = await createTenantToken(
      {
        ...updatedClaims,
        jti: newJti,
      },
      user.stayLoggedIn ?? false,
    );

    return NextResponse.json({
      success: true,
      data: {
        systemToken: newToken,
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
