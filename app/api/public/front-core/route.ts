import { NextResponse } from "next/server";
import { getCache } from "@/server/utils/cache";
import type { FrontCoreData } from "@/server/utils/FrontCore";
import Core from "@/server/utils/Core";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings. No authentication required.
 * Also includes db.frontend.* settings from setting for the frontend DB connection.
 */
export async function GET() {
  try {
    const data = await getCache<FrontCoreData>("core", "front-data");
    const settingsMap: Record<string, { value: string; description: string }> =
      {};

    // Only expose core-scoped front settings here; per-system overrides are
    // opaque to the public endpoint (the frontend resolves per-system keys on
    // demand via its own helpers).
    for (const [, setting] of data.settings) {
      if (setting.systemSlug !== "core") continue;
      settingsMap[setting.key] = {
        value: setting.value,
        description: setting.description ?? "",
      };
    }

    const core = Core.getInstance();
    const frontendDbKeys = [
      "db.frontend.url",
      "db.frontend.namespace",
      "db.frontend.database",
      "db.frontend.user",
      "db.frontend.pass",
    ];
    for (const key of frontendDbKeys) {
      const value = await core.getSetting(key);
      if (value !== undefined) {
        settingsMap[key] = { value, description: "" };
      }
    }

    return NextResponse.json({
      success: true,
      data: settingsMap,
    });
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
