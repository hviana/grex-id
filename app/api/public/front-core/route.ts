import Core from "@/server/utils/Core";
import { loadFrontSettingsForScope } from "@/server/db/queries/front-settings";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings for the core scope plus db.frontend.*
 * connection settings from the core setting table. No authentication required.
 */
export async function GET() {
  try {
    const core = Core.getInstance();

    const settingsMap: Record<string, { value: string; description: string }> =
      {};

    const coreFrontSettings = await loadFrontSettingsForScope("__core__");
    for (const [key, setting] of coreFrontSettings) {
      settingsMap[key] = {
        value: setting.value,
        description: setting.description ?? "",
      };
    }

    // Also include db.frontend.* settings from core setting table
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

    return Response.json({
      success: true,
      data: settingsMap,
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
