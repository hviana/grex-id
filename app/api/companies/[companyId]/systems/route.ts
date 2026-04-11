import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await params;

  if (!companyId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.companyId.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  const result = await db.query<[{ systemId: string }[]]>(
    `SELECT systemId FROM company_system WHERE companyId = $companyId`,
    { companyId: rid(companyId) },
  );

  const systemIds = (result[0] ?? []).map((r) => r.systemId);

  if (systemIds.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const systems = await db.query<[Record<string, unknown>[]]>(
    `SELECT * FROM system WHERE id IN $ids`,
    { ids: systemIds },
  );

  return NextResponse.json({ success: true, data: systems[0] ?? [] });
}
