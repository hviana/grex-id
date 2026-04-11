import { NextRequest, NextResponse } from "next/server";
import { listSystems, updateSystem } from "@/server/db/queries/systems";
import { getSetting, upsertSetting } from "@/server/db/queries/core-settings";
import Core from "@/server/utils/Core";

export async function GET() {
  const result = await listSystems({ limit: 200 });
  const genericSetting = await getSetting("terms.generic");
  const genericContent = genericSetting?.value ?? "";

  const systems = result.data.map((sys) => ({
    id: sys.id,
    name: sys.name,
    slug: sys.slug,
    termsOfService: sys.termsOfService ?? null,
    hasCustomTerms: !!sys.termsOfService,
    effectiveTerms: sys.termsOfService || genericContent || "",
  }));

  return NextResponse.json({
    success: true,
    data: {
      generic: genericContent,
      systems,
    },
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();

  // Update generic terms
  if (body.generic === true) {
    const content = typeof body.content === "string" ? body.content : "";
    await upsertSetting({
      key: "terms.generic",
      value: content,
      description:
        "Generic LGPD/terms of service HTML content (fallback when system has no specific terms)",
    });
    await Core.getInstance().reload();
    return NextResponse.json({ success: true });
  }

  // Update system-specific terms
  const { systemId, termsOfService } = body;
  if (!systemId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.system.required" },
      },
      { status: 400 },
    );
  }

  // Pass empty string to clear — updateSystem converts "" to undefined for SurrealDB
  await updateSystem(systemId, {
    termsOfService: typeof termsOfService === "string" ? termsOfService : "",
  });
  await Core.getInstance().reload();

  return NextResponse.json({ success: true });
}
