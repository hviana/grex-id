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
import { getDb, rid } from "@/server/db/connection";
import type { Voucher } from "@/src/contracts/voucher";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const result = await genericList<Voucher>({
    table: "voucher",
    select: "*, resourceLimitId.* AS resourceLimitId",
    searchFields: ["name"],
    limit,
    cursor,
    search,
  });

  return Response.json({ success: true, ...result });
}

const VOUCHER_FIELDS = [
  { field: "name" },
  { field: "applicableTenantIds" },
  { field: "applicablePlanIds" },
  { field: "expiresAt" },
] as const;

const RL_FIELDS = [
  { field: "benefits" },
  { field: "roleIds" },
  { field: "entityLimits" },
  { field: "apiRateLimit" },
  { field: "storageLimitBytes" },
  { field: "fileCacheLimitBytes" },
  { field: "credits" },
  { field: "priceModifier" },
  { field: "maxConcurrentDownloads" },
  { field: "maxConcurrentUploads" },
  { field: "maxDownloadBandwidthMB" },
  { field: "maxUploadBandwidthMB" },
  { field: "maxOperationCountByResourceKey" },
  { field: "creditLimitByResourceKey" },
  { field: "frontendDomains" },
] as const;

const VOUCHER_CASCADE = [{
  table: "resource_limit",
  sourceField: "resourceLimitId",
}] as const;

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    name,
    applicableTenantIds,
    applicablePlanIds,
    resourceLimits,
    expiresAt,
  } = body;

  const nameErrors = await validateField("name", name);
  if (nameErrors.length > 0 || !name) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: nameErrors.length > 0
            ? nameErrors
            : ["validation.voucher.nameRequired"],
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await genericCreate<Voucher>(
      {
        table: "voucher",
        skipAccessCheck: true,
        fields: [...VOUCHER_FIELDS],
        cascade: [...VOUCHER_CASCADE],
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
        applicableTenantIds: applicableTenantIds ?? [],
        applicablePlanIds: applicablePlanIds ?? [],
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
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
  } catch (e) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: String(e) },
      },
      { status: 500 },
    );
  }
}

/** PUT — updates a voucher and its resource_limit with auto-removal cascade (§7.7). */
async function putHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    id,
    name,
    applicableTenantIds,
    applicablePlanIds,
    resourceLimits,
    expiresAt,
  } = body;

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
    const voucherUpdates: Record<string, unknown> = {};

    if (name !== undefined) voucherUpdates.name = name;
    if (applicableTenantIds !== undefined) {
      voucherUpdates.applicableTenantIds = applicableTenantIds;
    }
    if (applicablePlanIds !== undefined) {
      voucherUpdates.applicablePlanIds = applicablePlanIds ?? [];
    }
    if (expiresAt !== undefined) {
      voucherUpdates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    const hasRoot = Object.keys(voucherUpdates).length > 0;
    const hasCascade = resourceLimits != null;

    if (!hasRoot && !hasCascade) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate<Voucher>(
      {
        table: "voucher",
        skipAccessCheck: true,
        fields: [...VOUCHER_FIELDS],
        cascade: [...VOUCHER_CASCADE],
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
      voucherUpdates,
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

    if (applicablePlanIds !== undefined || applicableTenantIds !== undefined) {
      const db = await getDb();
      const parts: string[] = [];
      const bindings: Record<string, unknown> = { id: rid(id) };

      if (
        applicablePlanIds !== undefined &&
        Array.isArray(applicablePlanIds) &&
        applicablePlanIds.length > 0
      ) {
        parts.push(
          `UPDATE subscription SET voucherId = NONE WHERE voucherId = $id AND planId NOT IN ${
            buildSetLiteral(applicablePlanIds as string[])
          }`,
        );
      }
      if (
        applicableTenantIds !== undefined &&
        Array.isArray(applicableTenantIds) &&
        applicableTenantIds.length > 0
      ) {
        parts.push(
          `UPDATE subscription SET voucherId = NONE WHERE voucherId = $id AND tenantIds NONEINSIDE ${
            buildSetLiteral(applicableTenantIds as string[])
          }`,
        );
      }

      if (parts.length > 0) await db.query(parts.join(";\n"), bindings);
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
        table: "voucher",
        skipAccessCheck: true,
        cascade: [
          {
            table: "resource_limit",
            sourceField: "resourceLimitId",
            onDelete: "delete",
          },
          {
            table: "subscription",
            parentField: "voucherId",
            onDelete: "detach",
          },
        ],
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

function buildSetLiteral(ids: string[]): string {
  if (ids.length === 0) return "<set>[]";
  const parts = ids.map((rid_: string) => {
    const [tb, k] = rid_.split(":");
    return `type::record("${tb}", "${k}")`;
  });
  return `{${parts.join(", ")},}`;
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
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
