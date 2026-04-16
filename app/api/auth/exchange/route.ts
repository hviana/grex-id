import { NextRequest, NextResponse } from "next/server";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import { isJtiRevoked, revokeJti } from "@/server/utils/token-revocation";
import { getDb, rid } from "@/server/db/connection";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  const token = authHeader.slice(7);

  try {
    const claims = await verifyTenantToken(token);

    // Only user tokens can be exchanged
    if (claims.actorType !== "user" || !claims.exchangeable) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "auth.error.exchangeNotAllowed",
          },
        },
        { status: 403 },
      );
    }

    // Check current token not revoked
    if (claims.jti && (await isJtiRevoked(claims.jti))) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    const body = await req.json();
    const { companyId, systemId } = body;

    if (!companyId || !systemId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.exchange.companyAndSystem",
          },
        },
        { status: 400 },
      );
    }

    const db = await getDb();

    // Verify user belongs to target company + system
    const membership = await db.query<[{ id: string; roles: string[] }[]]>(
      `SELECT id, roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
       LIMIT 1`,
      {
        userId: rid(claims.actorId),
        companyId: rid(companyId),
        systemId: rid(systemId),
      },
    );

    if (!membership[0] || membership[0].length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "auth.error.notMemberOfTenant",
          },
        },
        { status: 403 },
      );
    }

    const userRoles = membership[0][0].roles ?? [];

    // Resolve system slug
    const systemInfo = await db.query<[{ slug: string }[]]>(
      `SELECT slug FROM system WHERE id = $systemId LIMIT 1`,
      { systemId: rid(systemId) },
    );
    const systemSlug = systemInfo[0]?.[0]?.slug ?? "core";

    // Resolve permissions from roles
    const roleRecords = await db.query<[{ permissions: string[] }[]]>(
      `SELECT permissions FROM role WHERE id IN $roles`,
      { roles: userRoles.map((r: string) => rid(r)) },
    );
    const permissions = [
      ...new Set(
        roleRecords[0]?.flatMap((r) => r.permissions ?? []) ?? [],
      ),
    ];

    // Revoke old token and issue new one in a single batched query
    const newJti = crypto.randomUUID();

    await revokeJti(claims.jti, "exchanged");

    const newToken = await createTenantToken(
      {
        systemId,
        companyId,
        systemSlug,
        roles: userRoles,
        permissions,
        actorType: "user",
        actorId: claims.actorId,
        jti: newJti,
        exchangeable: true,
      },
      false,
    );

    return NextResponse.json({
      success: true,
      data: {
        systemToken: newToken,
        tenant: {
          systemId,
          companyId,
          systemSlug,
          roles: userRoles,
          permissions,
        },
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "auth.error.invalidToken",
        },
      },
      { status: 401 },
    );
  }
}
