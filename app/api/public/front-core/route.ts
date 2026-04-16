import { NextResponse } from "next/server";
import FrontCore from "@/server/utils/FrontCore";

/**
 * GET /api/public/front-core
 * Returns all front-safe settings. No authentication required.
 */
export async function GET() {
  try {
    const frontCore = FrontCore.getInstance();
    await frontCore.load();

    const settingsMap: Record<string, { value: string; description: string }> =
      {};
    for (const [key, setting] of frontCore.settings) {
      settingsMap[key] = {
        value: setting.value,
        description: setting.description ?? "",
      };
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
