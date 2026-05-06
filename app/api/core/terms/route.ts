import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { genericList, genericUpdate } from "@/server/db/queries/generics";
import type { System } from "@/src/contracts/system";
import {
  batchUpsertSettings,
  buildScopeKey,
} from "@/server/db/queries/core-settings";
import { get, updateTenantCache } from "@/server/utils/cache";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(_req: Request, _ctx: RequestContext) {
  const result = await genericList<System>({
    table: "system",
    limit: 200,
    allowSensitiveGlobalRead: true,
  });

  const genericContent = (await get(undefined, "setting.terms.generic")) ?? "";

  const systems = result.items.map((sys) => ({
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
  const { body, error } = await parseBody(req);
  if (error) return error;

  if (body.generic === true) {
    const content = typeof body.content === "string" ? body.content : "";
    await batchUpsertSettings([{
      key: "terms.generic",
      value: content,
      description: "core.terms.genericHint",
    }]);
    await updateTenantCache(undefined, "setting.terms.generic");
    updateTenantCache();
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
  const result = await genericUpdate<System>(
    {
      table: "system",
      fields: [{ field: "termsOfService" }],
      allowSensitiveGlobalMutation: true,
    },
    systemId,
    {
      termsOfService: typeof termsOfService === "string" ? termsOfService : "",
    },
  );

  if (!result.success) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: result.errors } },
      { status: 400 },
    );
  }

  updateTenantCache();

  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  getHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  putHandler,
);
