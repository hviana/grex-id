import Core from "@/server/utils/Core";
import FrontCore from "@/server/utils/FrontCore";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings. No authentication required.
 * Also includes db.frontend.* settings from setting for the frontend DB connection.
 */
export async function GET() {
  try {
    const frontCore = FrontCore.getInstance();
    const core = Core.getInstance();

    const settingsMap: Record<string, { value: string; description: string }> =
      {};

    // Expose core-level front settings
    const coreScope = await frontCore.getSetting("");
    // Access the core scope's full map through the lazy cache
    // For the public endpoint, we need all core-level front settings
    const { getCache } = await import("@/server/utils/cache");
    const { loadFrontSettingsForScope } = await import(
      "@/server/db/queries/front-settings"
    );

    // Ensure core scope is loaded
    let coreSettings: Map<string, { value: string; description?: string }>;
    try {
      coreSettings = await getCache<
        Map<string, { value: string; description?: string }>
      >("front-settings", "settings:__core__");
    } catch {
      // Fallback: load directly
      coreSettings = await loadFrontSettingsForScope("__core__") as Map<
        string,
        { value: string; description?: string }
      >;
    }

    for (const [key, setting] of coreSettings) {
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
