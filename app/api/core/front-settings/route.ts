import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/connection";
import FrontCore from "@/server/utils/FrontCore";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";

async function getHandler(req: NextRequest) {
  const frontCore = FrontCore.getInstance();
  await frontCore.load();

  const settings: Record<string, { id: string; key: string; value: string; description: string }>[] = [];
  for (const [, setting] of frontCore.settings) {
    settings.push({
      id: setting.id,
      key: setting.key,
      value: setting.value,
      description: setting.description ?? "",
    });
  }

  const missing = await frontCore.getMissingSettings();

  return NextResponse.json({
    success: true,
    data: { settings, missing },
  });
}

async function putHandler(req: NextRequest) {
  const body = await req.json();
  const { settings } = body as { settings: { key: string; value: string; description?: string }[] };

  if (!settings || !Array.isArray(settings)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.settings.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  for (const s of settings) {
    if (!s.key) continue;
    await db.query(
      `UPSERT front_core_setting SET
        key = $key,
        value = $value,
        description = $description,
        updatedAt = time::now()
      WHERE key = $key`,
      {
        key: s.key,
        value: s.value ?? "",
        description: s.description ?? "",
      },
    );
  }

  // Reload FrontCore cache
  await FrontCore.getInstance().reload();

  return NextResponse.json({
    success: true,
    message: "core.frontSettings.saved",
  });
}

export const GET = compose(withAuth({ roles: ["superuser"] }), async (req, _ctx, next) => {
  return getHandler(req as NextRequest);
});

export const PUT = compose(withAuth({ roles: ["superuser"] }), async (req, _ctx, next) => {
  return putHandler(req as NextRequest);
});
