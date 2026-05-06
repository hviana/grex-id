import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit } from "@/src/lib/validators";
import { validateField } from "@/server/utils/field-validator";
import { updateTenantCache } from "@/server/utils/cache";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import { rid } from "@/server/db/connection";
import type { Plan } from "@/src/contracts/plan";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const tenantId = url.searchParams.get("tenantId") ?? undefined;
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  if (systemId) {
    extraConditions.push(
      "tenantIds ANYINSIDE (SELECT VALUE id FROM tenant WHERE !actorId AND !companyId AND systemId = $filterSystemId)",
    );
    extraBindings.filterSystemId = rid(systemId);
  } else if (tenantId) {
    extraConditions.push("tenantIds CONTAINS $tenantId");
    extraBindings.tenantId = rid(tenantId);
  }

  const result = await genericList<Plan>({
    table: "plan",
    select:
      "id, name, description, price, currency, recurrenceDays, isActive, tenantIds, resourceLimitId, createdAt, updatedAt",
    searchFields: ["name"],
    extraConditions,
    extraBindings,
    extraAccessFields: ["tenantIds"],
    allowRawExtraConditions: true,
    skipAccessCheck: true,
    limit,
    cursor,
    search,
    cascade: [{
      table: "resource_limit",
      sourceField: "resourceLimitId",
      select:
        "id, roleIds, benefits, entityLimits, apiRateLimit, storageLimitBytes, fileCacheLimitBytes, credits, maxConcurrentDownloads, maxConcurrentUploads, maxDownloadBandwidthMB, maxUploadBandwidthMB, maxOperationCountByResourceKey, creditLimitByResourceKey, frontendDomains",
      children: [{
        table: "role",
        sourceField: "roleIds",
        isArray: true,
        select: "id, name",
      }],
    }],
  });

  return Response.json({ success: true, ...result });
}

const PLAN_FIELDS = [
  { field: "name" },
  { field: "description" },
  { field: "price" },
  { field: "currency" },
  { field: "recurrenceDays" },
  { field: "isActive" },
] as const;

const RL_FIELDS = [
  { field: "benefits" },
  { field: "roleIds" },
  { field: "entityLimits" },
  { field: "apiRateLimit" },
  { field: "storageLimitBytes" },
  { field: "fileCacheLimitBytes" },
  { field: "credits" },
  { field: "maxConcurrentDownloads" },
  { field: "maxConcurrentUploads" },
  { field: "maxDownloadBandwidthMB" },
  { field: "maxUploadBandwidthMB" },
  { field: "maxOperationCountByResourceKey" },
  { field: "creditLimitByResourceKey" },
  { field: "frontendDomains" },
] as const;

const PLAN_CASCADE = [{
  table: "resource_limit",
  sourceField: "resourceLimitId",
}] as const;

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    name,
    description,
    systemId,
    price,
    currency,
    recurrenceDays,
    isActive,
    resourceLimits,
  } = body;

  const errors: string[] = [];
  errors.push(...await validateField("name", name));
  if (!systemId) errors.push("validation.system.required");
  if (price === undefined) errors.push("validation.plan.priceRequired");
  if (!recurrenceDays) errors.push("validation.plan.recurrenceRequired");

  if (errors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors } },
      { status: 400 },
    );
  }

  try {
    const result = await genericCreate<Plan>(
      {
        table: "plan",
        tenant: { systemId },
        skipAccessCheck: true,
        allowCreateCallerTenant: true,
        fields: [...PLAN_FIELDS],
        cascade: [...PLAN_CASCADE],
        cascadeData: resourceLimits != null
          ? [{
            table: "resource_limit",
            rows: [resourceLimits as Record<string, unknown>],
            fields: [...RL_FIELDS],
          }]
          : undefined,
      },
      {
        name,
        description: description ?? "",
        price: Math.round(Number(price) * 100),
        currency: currency ?? "USD",
        recurrenceDays: Number(recurrenceDays),
        isActive: isActive ?? true,
      },
    );

    if (!result.success) {
      if (result.duplicateFields?.length) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: result.duplicateFields.map((f) =>
                `validation.${f}.duplicate`
              ),
            },
          },
          { status: 409 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors?.flatMap((e) => e.errors) ?? [],
          },
        },
        { status: 400 },
      );
    }

    updateTenantCache();

    return Response.json(
      { success: true, data: result.data },
      { status: 201 },
    );
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { id, resourceLimits, ...data } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const planUpdates: Record<string, unknown> = {};

    if (data.name !== undefined) planUpdates.name = data.name;
    if (data.description !== undefined) {
      planUpdates.description = data.description ?? "";
    }
    if (data.price !== undefined) {
      planUpdates.price = Math.round(Number(data.price) * 100);
    }
    if (data.currency !== undefined) planUpdates.currency = data.currency;
    if (data.recurrenceDays !== undefined) {
      planUpdates.recurrenceDays = data.recurrenceDays;
    }
    if (data.isActive !== undefined) planUpdates.isActive = data.isActive;

    const hasRoot = Object.keys(planUpdates).length > 0;
    const hasCascade = resourceLimits != null;

    if (!hasRoot && !hasCascade) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate<Plan>(
      {
        table: "plan",
        skipAccessCheck: true,
        fields: [...PLAN_FIELDS],
        cascade: [...PLAN_CASCADE],
        cascadeGateFields: !hasRoot && hasCascade
          ? ["resourceLimitId"]
          : undefined,
        cascadeData: hasCascade
          ? [{
            table: "resource_limit",
            data: resourceLimits as Record<string, unknown>,
            fields: [...RL_FIELDS],
          }]
          : undefined,
      },
      id,
      planUpdates,
    );

    if (!result.success) {
      const firstError = result.errors?.[0];
      if (firstError?.field === "id") {
        return Response.json(
          {
            success: false,
            error: { code: "ERROR", message: "common.error.notFound" },
          },
          { status: 404 },
        );
      }
      if (result.duplicateFields?.length) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: result.duplicateFields.map((f) =>
                `validation.${f}.duplicate`
              ),
            },
          },
          { status: 409 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors?.flatMap((e) => e.errors) ?? [],
          },
        },
        { status: 400 },
      );
    }

    updateTenantCache();

    return Response.json({ success: true, data: result.data });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const { deleted } = await genericDelete(
      {
        table: "plan",
        skipAccessCheck: true,
        cascade: [{
          table: "resource_limit",
          sourceField: "resourceLimitId",
          onDelete: "delete",
        }],
      },
      id,
    );

    if (!deleted) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.notFound" },
        },
        { status: 404 },
      );
    }

    updateTenantCache();

    return Response.json({ success: true });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  deleteHandler,
);
