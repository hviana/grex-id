import { NextRequest, NextResponse } from "next/server";
import Core from "@/server/utils/Core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const useDefault = searchParams.get("default") === "true";

  const core = Core.getInstance();

  let resolvedSlug = slug;
  if (!resolvedSlug && useDefault) {
    resolvedSlug = (await core.getSetting("app.defaultSystem")) || null;
  }

  const genericTerms = (await core.getSetting("terms.generic")) || "";

  if (!resolvedSlug) {
    return NextResponse.json({
      success: true,
      data: genericTerms
        ? {
          name: (await core.getSetting("app.name")) || "Core",
          slug: "",
          logoUri: "",
          termsOfService: genericTerms,
        }
        : null,
    });
  }

  const system = await core.getSystemBySlug(resolvedSlug);
  if (!system) {
    return NextResponse.json({
      success: true,
      data: genericTerms
        ? {
          name: (await core.getSetting("app.name")) || "Core",
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
