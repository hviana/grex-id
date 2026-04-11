import { NextResponse } from "next/server";
import Core from "@/server/utils/Core";

export async function GET() {
  const core = Core.getInstance();
  return NextResponse.json({
    success: true,
    data: await core.getMissingSettings(),
  });
}
