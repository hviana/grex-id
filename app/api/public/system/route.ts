import { NextRequest } from "next/server";
import { get } from "@/server/utils/cache";
import { getTranslationsForClient } from "@/server/i18n-registry";
import type { CoreData } from "@/src/contracts/high-level/cache-data";
import type { Plan } from "@/src/contracts/plan";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const locale = searchParams.get("locale") ?? undefined;
  const frameworks = searchParams.get("frameworks")
    ?.split(",").filter(Boolean) ?? undefined;

  if (searchParams.get("list") === "true") {
    const coreData = (await get(undefined, "core-data")) as unknown as CoreData;
    const systems = Object.values(coreData.systemsBySlug);
    const result = [];
    for (const s of systems) {
      if (s.slug === "core") continue;
      const plans = coreData.plansBySystem[String(s.id)] ?? [];
      result.push({
        id: s.id,
        name: s.name,
        slug: s.slug,
        logoUri: s.logoUri ?? "",
        plans: plans.filter((p: Plan) => p.isActive).map((p: Plan) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          recurrenceDays: p.recurrenceDays,
          isActive: p.isActive,
          _cascade: {
            resourceLimitId: p.resourceLimitId,
          },
        })),
      });
    }
    return Response.json({ success: true, data: result });
  }

  const resolvedSlug = slug ??
    (await get(undefined, "setting.app.defaultSystem")) as string | null ??
    "core";

  const translations = locale
    ? getTranslationsForClient(locale, resolvedSlug, frameworks)
    : undefined;

  if (!resolvedSlug) {
    return Response.json({ success: true, data: null, translations });
  }

  const coreData = (await get(undefined, "core-data")) as unknown as CoreData;
  const system = coreData.systemsBySlug[resolvedSlug];
  if (!system) {
    return Response.json({ success: true, data: null, translations });
  }

  const genericTerms =
    (await get(undefined, "setting.terms.generic")) as string || "";

  return Response.json({
    success: true,
    data: {
      name: system.name,
      slug: system.slug,
      logoUri: system.logoUri,
      defaultLocale: system.defaultLocale,
      termsOfService: system.termsOfService || genericTerms || undefined,
    },
    translations,
  });
}
