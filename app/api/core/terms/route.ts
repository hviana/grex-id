import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { genericList, genericUpdate } from "@/server/db/queries/generics";
import type { System } from "@/src/contracts/system";
import { getSetting, upsertSetting } from "@/server/db/queries/core-settings";
import Core from "@/server/utils/Core";

async function getHandler(_req: Request, _ctx: RequestContext) {
  const result = await genericList<System>(
    { table: "system" },
    { limit: 200 },
  );

  // Generic terms come from core system-level settings (no tenantId override)
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

  return Response.json({
    success: true,
    data: {
      generic: genericContent,
      systems,
    },
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();

  // Update generic terms (core system-level — no tenantId override)
  if (body.generic === true) {
    const content = typeof body.content === "string" ? body.content : "";
    await upsertSetting({
      key: "terms.generic",
      value: content,
      description: "core.terms.genericHint",
    });
    await Core.getInstance().reload();
    return Response.json({ success: true });
  }

  // Update system-specific terms
  const { systemId, termsOfService } = body;
  if (!systemId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.system.required"] },
      },
      { status: 400 },
    );
  }

  // Pass empty string to clear -- genericUpdate converts "" to undefined for SurrealDB
  await genericUpdate<System>(
    { table: "system" },
    systemId,
    {
      termsOfService: typeof termsOfService === "string" ? termsOfService : "",
    },
  );
  await Core.getInstance().reload();

  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  getHandler,
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  putHandler,
);
