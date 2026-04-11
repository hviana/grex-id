import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken, hashToken } from "@/server/utils/token";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const companyId = url.searchParams.get("companyId");

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  let query =
    "SELECT id, name, description, permissions, monthlySpendLimit, expiresAt, createdAt FROM api_token";
  const conditions: string[] = [];

  if (userId) {
    conditions.push("userId = $userId");
    bindings.userId = rid(userId);
  }
  if (companyId) {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(companyId);
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  return NextResponse.json({ success: true, data: result[0] ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    name,
    description,
    userId,
    companyId,
    systemId,
    permissions,
    monthlySpendLimit,
    expiresAt,
  } = body;

  if (!name || !userId || !companyId || !systemId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const rawToken = generateSecureToken();
  const tokenHash = await hashToken(rawToken);

  const db = await getDb();
  await db.query(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      name = $name,
      description = $description,
      tokenHash = $tokenHash,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      expiresAt = $expiresAt`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
      name,
      description: description ?? undefined,
      tokenHash,
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    },
  );

  return NextResponse.json({
    success: true,
    data: { token: rawToken },
  }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
  return NextResponse.json({ success: true });
}
