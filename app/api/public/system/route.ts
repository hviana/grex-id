import { NextRequest } from "next/server";
import Core from "@/server/utils/Core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const useDefault = searchParams.get("default") === "true";

  if (searchParams.get("list") === "true") {
    const core = Core.getInstance();
    const systems = await core.getAllSystems();
    const result = [];
    for (const s of systems) {
      const plans = await core.getPlansForSystem(s.id);
      result.push({
        id: s.id,
        name: s.name,
        slug: s.slug,
        logoUri: s.logoUri ?? "",
        plans: plans.filter((p) => p.isActive).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          recurrenceDays: p.recurrenceDays,
          benefits: p.benefits,
          roles: p.roles,
          entityLimits: p.entityLimits,
          apiRateLimit: p.apiRateLimit,
          storageLimitBytes: p.storageLimitBytes,
          fileCacheLimitBytes: p.fileCacheLimitBytes,
          planCredits: p.planCredits,
          maxConcurrentDownloads: p.maxConcurrentDownloads,
          maxConcurrentUploads: p.maxConcurrentUploads,
          maxDownloadBandwidthMB: p.maxDownloadBandwidthMB,
          maxUploadBandwidthMB: p.maxUploadBandwidthMB,
          maxOperationCount: p.maxOperationCount,
          isActive: p.isActive,
        })),
      });
    }
    return Response.json({ success: true, data: result });
  }

  const core = Core.getInstance();

  let resolvedSlug = slug;
  if (!resolvedSlug && useDefault) {
    resolvedSlug = (await core.getSetting("app.defaultSystem")) || null;
  }

  const genericTerms = (await core.getSetting("terms.generic")) || "";

  if (!resolvedSlug) {
    return Response.json({
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
    return Response.json({
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

  return Response.json({
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
