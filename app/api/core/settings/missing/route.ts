import { NextResponse } from "next/server";
import Core from "@/server/utils/Core";

export async function GET() {
  const core = Core.getInstance();
  await core.ensureLoaded();
  return NextResponse.json({
    success: true,
    data: core.getMissingSettings(),
  });
}
