import { NextRequest, NextResponse } from "next/server";
import Core from "@/server/utils/Core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const useDefault = searchParams.get("default") === "true";

  const core = Core.getInstance();
  await core.ensureLoaded();

  let resolvedSlug = slug;
  if (!resolvedSlug && useDefault) {
    resolvedSlug = core.getSetting("app.defaultSystem") || null;
  }

  const genericTerms = core.getSetting("terms.generic") || "";

  if (!resolvedSlug) {
    return NextResponse.json({
      success: true,
      data: genericTerms
        ? {
          name: core.getSetting("app.name") || "Core",
          slug: "",
          logoUri: "",
          termsOfService: genericTerms,
        }
        : null,
    });
  }

  const system = core.getSystemBySlug(resolvedSlug);
  if (!system) {
    return NextResponse.json({
      success: true,
      data: genericTerms
        ? {
          name: core.getSetting("app.name") || "Core",
          slug: "",
          logoUri: "",
          termsOfService: genericTerms,
        }
        : null,
    });
  }

  const termsOfService = system.termsOfService || genericTerms || undefined;

  return NextResponse.json({
    success: true,
    data: {
      name: system.name,
      slug: system.slug,
      logoUri: system.logoUri,
      defaultLocale: system.defaultLocale,
      termsOfService,
    },
  });
}
