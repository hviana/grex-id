import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const systemId = url.searchParams.get("systemId");

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  let query = "SELECT * FROM connected_app";
  const conditions: string[] = [];

  if (companyId) {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(companyId);
  }
  if (systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(systemId);
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  return NextResponse.json({ success: true, data: result[0] ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, companyId, systemId, permissions, monthlySpendLimit } = body;

  if (!name || !companyId || !systemId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.connectedApp.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    `CREATE connected_app SET
      name = $name,
      companyId = $companyId,
      systemId = $systemId,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit`,
    {
      name,
      companyId: rid(companyId),
      systemId: rid(systemId),
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
    },
  );

  return NextResponse.json(
    { success: true, data: result[0]?.[0] },
    { status: 201 },
  );
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, name, permissions, monthlySpendLimit } = body;

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
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (name !== undefined) {
    sets.push("name = $name");
    bindings.name = name;
  }
  if (permissions !== undefined) {
    sets.push("permissions = $permissions");
    bindings.permissions = permissions;
  }
  if (monthlySpendLimit !== undefined) {
    sets.push("monthlySpendLimit = $monthlySpendLimit");
    bindings.monthlySpendLimit = monthlySpendLimit || undefined;
  }

  if (sets.length === 0) {
    return NextResponse.json({ success: true });
  }

  const result = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );

  return NextResponse.json({ success: true, data: result[0]?.[0] });
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
