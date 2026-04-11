import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { sanitizeString } from "@/src/lib/validators";

export async function GET() {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    "SELECT * FROM core_setting ORDER BY key ASC",
  );

  return NextResponse.json({
    success: true,
    data: result[0] ?? [],
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { settings } = body;

  if (!Array.isArray(settings)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "settings must be an array" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const results: Record<string, unknown>[] = [];

  for (const setting of settings) {
    const { id, key, value, description } = setting;

    if (!key) continue;

    if (id) {
      const updated = await db.query<[Record<string, unknown>[]]>(
        `UPDATE $id SET
          key = $key,
          value = $value,
          description = $description,
          updatedAt = time::now()
        RETURN AFTER`,
        {
          id: rid(id),
          key: sanitizeString(key),
          value: sanitizeString(value ?? ""),
          description: sanitizeString(description ?? ""),
        },
      );
      if (updated[0]?.[0]) results.push(updated[0][0]);
    } else {
      const created = await db.query<[Record<string, unknown>[]]>(
        `CREATE core_setting SET
          key = $key,
          value = $value,
          description = $description`,
        {
          key: sanitizeString(key),
          value: sanitizeString(value ?? ""),
          description: sanitizeString(description ?? ""),
        },
      );
      if (created[0]?.[0]) results.push(created[0][0]);
    }
  }

  return NextResponse.json({ success: true, data: results });
}
