import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import type { Setting } from "@/src/contracts/setting";
import type { CoreData } from "@/src/contracts/high-level/cache-data";
import type { Tenant } from "@/src/contracts/tenant";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import { get, updateTenantCache } from "@/server/utils/cache";

const MAX_SETTINGS_SIZE_BYTES = 64 * 1024;
const SELECT = "id, key, value, description, tenantIds, createdAt, updatedAt";
const FIELDS = [{ field: "key" }, { field: "value" }, { field: "description" }];

async function resolveSystemTenant(systemId?: string): Promise<Tenant> {
  if (!systemId) {
    const coreData = await get(undefined, "core-data") as unknown as CoreData;
    systemId = coreData.systemsBySlug["core"]?.id;
  }
  return { systemId };
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const systemId = url.searchParams.get("systemId") || undefined;
  const tenant = await resolveSystemTenant(systemId);

  const result = await genericList<Setting>({
    table: "setting",
    tenant,
    select: SELECT,
    orderBy: "key ASC",
    limit: 200,
  });

  const data = result.items.map((s) => ({ ...s, id: String(s.id) }));
  return Response.json({ success: true, data });
}

async function putHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;

  const { settings } = body;
  const systemId = typeof body.systemId === "string"
    ? body.systemId
    : undefined;
  const tenant = await resolveSystemTenant(systemId);

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

  for (
    const s of (settings as Record<string, unknown>[]).filter((s) => s.key)
  ) {
    const key = String(s.key ?? "").trim().replace(/[<>]/g, "");
    const value = String(s.value ?? "").trim().replace(/[<>]/g, "");
    const description = String(s.description ?? "").trim().replace(/[<>]/g, "");

    const existing = await genericList<Setting>({
      table: "setting",
      tenant,
      select: SELECT,
      extraConditions: ["key = $key"],
      extraBindings: { key },
      extraAccessFields: ["key"],
      allowRawExtraConditions: true,
      limit: 1,
    });

    if (existing.items.length > 0) {
      const updateResult = await genericUpdate<Setting>(
        { table: "setting", tenant, fields: FIELDS },
        existing.items[0].id,
        { key, value, description },
      );
      if (!updateResult.success) {
        return Response.json(
          {
            success: false,
            error: {
              code: "ERROR",
              message: updateResult.errors?.[0]?.errors?.[0] ??
                "common.error.generic",
            },
          },
          { status: 400 },
        );
      }
    } else {
      const createResult = await genericCreate<Setting>(
        {
          table: "setting",
          tenant,
          fields: FIELDS,
          allowCreateCallerTenant: true,
        },
        { key, value, description },
      );
      if (!createResult.success) {
        return Response.json(
          {
            success: false,
            error: {
              code: "ERROR",
              message: createResult.errors?.[0]?.errors?.[0] ??
                "common.error.generic",
            },
          },
          { status: 400 },
        );
      }
    }
  }

  updateTenantCache(tenant, "setting");

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;

  const { key } = body;
  const systemId = typeof body.systemId === "string"
    ? body.systemId
    : undefined;
  const tenant = await resolveSystemTenant(systemId);

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

  const existing = await genericList<Setting>({
    table: "setting",
    tenant,
    select: SELECT,
    extraConditions: ["key = $key"],
    extraBindings: { key: key as string },
    extraAccessFields: ["key"],
    allowRawExtraConditions: true,
    limit: 1,
  });

  if (existing.items.length > 0) {
    const deleteResult = await genericDelete(
      { table: "setting", tenant },
      existing.items[0].id,
    );
    if (!deleteResult.success) {
      return Response.json(
        {
          success: false,
          error: {
            code: "ERROR",
            message: deleteResult.errorKey ?? "common.error.generic",
          },
        },
        { status: 400 },
      );
    }
  }

  updateTenantCache(tenant, "setting");

  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    requireAuthenticated: true,
  }),
  getHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    requireAuthenticated: true,
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    requireAuthenticated: true,
  }),
  deleteHandler,
);
