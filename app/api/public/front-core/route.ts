import { NextResponse } from "next/server";
import FrontCore from "@/server/utils/FrontCore";
import Core from "@/server/utils/Core";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings. No authentication required.
 * Also includes db.frontend.* settings from setting for the frontend DB connection.
 */
export async function GET() {
  try {
    const frontCore = FrontCore.getInstance();
    if (frontCore.settings.size === 0) {
      await frontCore.load();
    }
    const core = Core.getInstance();

    const settingsMap: Record<string, { value: string; description: string }> =
      {};
    for (const [key, setting] of frontCore.settings) {
      settingsMap[key] = {
        value: setting.value,
        description: setting.description ?? "",
      };
    }

    // Include frontend DB connection settings from setting
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
