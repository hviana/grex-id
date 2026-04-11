import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("q") ?? "";
  const systemSlug = url.searchParams.get("systemSlug") ?? "grex-id";

  if (!search || search.length < 2) {
    return NextResponse.json({ success: true, data: [] });
  }

  try {
    const db = await getDb();
    const result = await db.query<
      [unknown[], { id: string; companyId: { id: string; name: string } }[]]
    >(
      `LET $sys = (SELECT id FROM system WHERE slug = $systemSlug LIMIT 1);
       SELECT companyId FROM company_system
       WHERE systemId = $sys[0].id
       FETCH companyId;`,
      { systemSlug },
    );

    const rows = result[1] ?? [];
    const searchLower = search.toLowerCase();
    const data = rows
      .filter((row) => {
        const company = row.companyId as
          | { id: string; name: string }
          | undefined;
        return company?.name?.toLowerCase().includes(searchLower);
      })
      .slice(0, 20)
      .map((row) => {
        const company = row.companyId as { id: string; name: string };
        return { id: company.id, label: company.name };
      });

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
