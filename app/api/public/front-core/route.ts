import { get } from "@/server/utils/cache";
import { loadFrontSettingsForScope } from "@/server/db/queries/front-settings";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings for the core scope plus db.frontend.*
 * connection settings from the core setting table. No authentication required.
 * Also includes the DB server timezone offset in minutes.
 */
export async function GET() {
  try {
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
      const value = await get(undefined, `setting.${key}`);
      if (value !== undefined) {
        settingsMap[key] = { value: value as string, description: "" };
      }
    }

    // Include DB timezone offset (signed integer in minutes)
    const timezoneOffsetMinutes = (await get(undefined, "timezone")) as number;

    return Response.json({
      success: true,
      data: settingsMap,
      timezoneOffsetMinutes,
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
