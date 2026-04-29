import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import { genericDelete, genericList } from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import {
  createPlanWithResourceLimit,
  updatePlanWithResourceLimit,
} from "@/server/db/queries/plans";
import type { Plan } from "@/src/contracts/plan";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const tenantId = url.searchParams.get("tenantId") ?? undefined;

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  if (tenantId) {
    extraConditions.push("tenantIds CONTAINS $tenantId");
    extraBindings.tenantId = tenantId;
  }

  const result = await genericList<Plan>({
    table: "plan",
    select: "*, resourceLimitId.* AS resourceLimitId",
    searchFields: ["name"],
    extraConditions,
    extraBindings,
    limit,
    cursor,
    search,
  });

  return Response.json({ success: true, ...result });
}

const RL_FIELDS = [
  "benefits",
  "roleIds",
  "entityLimits",
  "apiRateLimit",
  "storageLimitBytes",
  "fileCacheLimitBytes",
  "credits",
  "maxConcurrentDownloads",
  "maxConcurrentUploads",
  "maxDownloadBandwidthMB",
  "maxUploadBandwidthMB",
  "maxOperationCountByResourceKey",
  "creditLimitByResourceKey",
  "frontendDomains",
] as const;

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    name,
    description,
    tenantId,
    price,
    currency,
    recurrenceDays,
    isActive,
    resourceLimits,
  } = body;

  const errors: string[] = [];
  errors.push(...await validateField("name", name));
  if (!tenantId) errors.push("validation.tenant.required");
  if (price === undefined) errors.push("validation.plan.priceRequired");
  if (!recurrenceDays) errors.push("validation.plan.recurrenceRequired");

  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors },
      },
      { status: 400 },
    );
  }

  try {
    const plan = await createPlanWithResourceLimit({
      name: await standardizeField("name", sanitizeString(name)),
      description: sanitizeString(description ?? ""),
      tenantId,
      price: Math.round(Number(price) * 100),
      currency: currency ?? "USD",
      recurrenceDays: Number(recurrenceDays),
      isActive: isActive ?? true,
      resourceLimits: resourceLimits as Record<string, unknown> | undefined,
    });

    if (!plan) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: plan },
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
    const planSets: string[] = [];
    const rlSets: string[] = [];
    const bindings: Record<string, unknown> = {};

    const planFields = [
      "name",
      "description",
      "price",
      "currency",
      "recurrenceDays",
      "isActive",
    ] as const;

    for (const field of planFields) {
      if (data[field] !== undefined) {
        const value = data[field];
        bindings[field] = field === "name" || field === "description"
          ? await standardizeField(field, sanitizeString(value))
          : field === "price"
          ? Math.round(Number(value) * 100)
          : value;
        planSets.push(`${field} = $${field}`);
      }
    }

    if (resourceLimits && typeof resourceLimits === "object") {
      const rl = resourceLimits as Record<string, unknown>;
      for (const field of RL_FIELDS) {
        if (rl[field] !== undefined) {
          const value = rl[field];
          if (
            field === "entityLimits" &&
            (!value ||
              (typeof value === "object" &&
                Object.keys(value as object).length === 0))
          ) {
            rlSets.push("entityLimits = NONE");
          } else {
            bindings[field] = value;
            rlSets.push(`${field} = $${field}`);
          }
        }
      }
    }

    if (planSets.length === 0 && rlSets.length === 0) {
      return Response.json({ success: true, data: null });
    }

    const updated = await updatePlanWithResourceLimit(
      id,
      planSets,
      rlSets,
      bindings,
    );

    if (!updated) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.notFound" },
        },
        { status: 404 },
      );
    }

    await Core.getInstance().reload();

    return Response.json({ success: true, data: updated });
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
    const { deleted } = await genericDelete({ table: "plan" }, id);

    if (!deleted) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.notFound" },
        },
        { status: 404 },
      );
    }

    await Core.getInstance().reload();

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
    roles: ["superuser"],
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  deleteHandler,
);
