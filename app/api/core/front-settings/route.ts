import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  batchUpsertFrontSettings,
  deleteFrontSetting,
  listFrontSettings,
} from "@/server/db/queries/front-settings";
import { buildScopeKey } from "@/server/db/queries/core-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import FrontCore from "@/server/utils/FrontCore";

const MAX_SETTINGS_SIZE_BYTES = 64 * 1024; // 64 KB

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const systemId = url.searchParams.get("systemId") || undefined;
  const companyId = url.searchParams.get("companyId") || undefined;
  const actorId = url.searchParams.get("actorId") || undefined;

  const scopeKey = buildScopeKey({ systemId, companyId, actorId });
  const settings = (await listFrontSettings(
    scopeKey === "__core__" ? undefined : scopeKey,
  )).map((s) => ({
    id: s.id,
    key: s.key,
    value: s.value,
    description: s.description ?? "",
    tenantIds: s.tenantIds,
  }));

  const missing = await FrontCore.getInstance().getMissingSettings();

  return Response.json({
    success: true,
    data: { settings, missing },
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json() as Record<string, unknown>;
  const { settings } = body as {
    settings: { key: string; value: string; description?: string }[];
  };
  const systemId = typeof body.systemId === "string"
    ? body.systemId
    : undefined;
  const companyId = typeof body.companyId === "string"
    ? body.companyId
    : undefined;
  const actorId = typeof body.actorId === "string" ? body.actorId : undefined;

  if (!settings || !Array.isArray(settings)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.settings.arrayRequired"],
        },
      },
      { status: 400 },
    );
  }

  // Validate total size
  let totalSize = 0;
  for (const s of settings) {
    if (s.value) totalSize += s.value.length;
    if (s.description) totalSize += s.description.length;
  }
  if (totalSize > MAX_SETTINGS_SIZE_BYTES) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.settings.sizeExceeded"],
        },
      },
      { status: 400 },
    );
  }

  const scopeKey = buildScopeKey({ systemId, companyId, actorId });

  const items: {
    key: string;
    value: string;
    description: string;
    scopeKey?: string;
  }[] = [];
  for (const s of settings.filter((s) => s.key)) {
    items.push({
      key: await standardizeField("name", s.key),
      value: s.value ?? "",
      description: s.description ?? "",
      scopeKey: scopeKey === "__core__" ? undefined : scopeKey,
    });
  }

  await batchUpsertFrontSettings(items);
  await FrontCore.getInstance().refreshSettingsScope(scopeKey);

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json() as Record<string, unknown>;
  const { key } = body;
  const systemId = typeof body.systemId === "string"
    ? body.systemId
    : undefined;
  const companyId = typeof body.companyId === "string"
    ? body.companyId
    : undefined;
  const actorId = typeof body.actorId === "string" ? body.actorId : undefined;

  if (!key) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.settings.keyRequired"],
        },
      },
      { status: 400 },
    );
  }

  const scopeKey = buildScopeKey({ systemId, companyId, actorId });
  await deleteFrontSetting(
    key as string,
    scopeKey === "__core__" ? undefined : scopeKey,
  );
  await FrontCore.getInstance().refreshSettingsScope(scopeKey);
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

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  deleteHandler,
);
