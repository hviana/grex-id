import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  batchUpsertSettings,
  buildScopeKey,
  deleteSetting,
  listSettings,
} from "@/server/db/queries/core-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import Core from "@/server/utils/Core";
import type { SettingScope } from "@/server/utils/Core";

const MAX_SETTINGS_SIZE_BYTES = 64 * 1024; // 64 KB

function checkScopePermission(
  ctx: RequestContext,
  scope: SettingScope,
): Response | null {
  const tenant = ctx.tenant;
  if (!tenant) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.forbidden" },
      },
      { status: 403 },
    );
  }

  // Superuser has full access
  if (tenant.roles.includes("superuser")) return null;

  // Actor-scoped: the actor themselves or admin of the system+company
  if (scope.actorId && scope.companyId && scope.systemId) {
    const isActor = tenant.actorId === scope.actorId;
    const isAdmin = tenant.companyId === scope.companyId &&
      tenant.systemId === scope.systemId &&
      tenant.roles.includes("admin");
    if (isActor || isAdmin) return null;
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.forbidden" },
      },
      { status: 403 },
    );
  }

  // Company-system scoped: admin of that system+company
  if (scope.companyId && scope.systemId) {
    if (
      tenant.companyId === scope.companyId &&
      tenant.systemId === scope.systemId &&
      tenant.roles.includes("admin")
    ) {
      return null;
    }
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.forbidden" },
      },
      { status: 403 },
    );
  }

  // System-scoped or core-level: superuser only (checked above)
  return Response.json(
    {
      success: false,
      error: { code: "FORBIDDEN", message: "common.error.forbidden" },
    },
    { status: 403 },
  );
}

function parseScopeFromParams(
  params: URLSearchParams,
): SettingScope {
  const scope: SettingScope = {};
  const systemId = params.get("systemId");
  const companyId = params.get("companyId");
  const actorId = params.get("actorId");
  if (systemId) scope.systemId = systemId;
  if (companyId) scope.companyId = companyId;
  if (actorId) scope.actorId = actorId;
  return scope;
}

function parseScopeFromBody(body: Record<string, unknown>): SettingScope {
  const scope: SettingScope = {};
  if (typeof body.systemId === "string") scope.systemId = body.systemId;
  if (typeof body.companyId === "string") scope.companyId = body.companyId;
  if (typeof body.actorId === "string") scope.actorId = body.actorId;
  return scope;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const scope = parseScopeFromParams(url.searchParams);

  const denied = checkScopePermission(ctx, scope);
  if (denied) return denied;

  const scopeKey = buildScopeKey(scope);
  const data = await listSettings(
    scopeKey === "__core__" ? undefined : scopeKey,
  );
  return Response.json({ success: true, data });
}

async function putHandler(req: Request, ctx: RequestContext) {
  const body = await req.json() as Record<string, unknown>;
  const { settings } = body;
  const scope = parseScopeFromBody(body);

  const denied = checkScopePermission(ctx, scope);
  if (denied) return denied;

  if (!Array.isArray(settings)) {
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
  for (const s of settings as Record<string, unknown>[]) {
    if (typeof s.value === "string") totalSize += s.value.length;
    if (typeof s.description === "string") totalSize += s.description.length;
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

  const scopeKey = buildScopeKey(scope);
  const items: {
    key: string;
    value: string;
    description: string;
    scopeKey?: string;
  }[] = [];
  for (
    const s of (settings as Record<string, unknown>[]).filter((s) => s.key)
  ) {
    items.push({
      key: await standardizeField("name", String(s.key ?? "")),
      value: await standardizeField("name", String(s.value ?? "")),
      description: await standardizeField("name", String(s.description ?? "")),
      scopeKey: scopeKey === "__core__" ? undefined : scopeKey,
    });
  }

  await batchUpsertSettings(items);
  await Core.getInstance().refreshSettingsScope(scopeKey);

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json() as Record<string, unknown>;
  const { key } = body;
  const scope = parseScopeFromBody(body);

  const denied = checkScopePermission(ctx, scope);
  if (denied) return denied;

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

  const scopeKey = buildScopeKey(scope);
  await deleteSetting(
    key as string,
    scopeKey === "__core__" ? undefined : scopeKey,
  );
  await Core.getInstance().refreshSettingsScope(scopeKey);
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true }),
  getHandler,
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true }),
  putHandler,
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true }),
  deleteHandler,
);
