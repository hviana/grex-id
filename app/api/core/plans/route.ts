import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import { genericDelete, genericList } from "@/server/db/queries/generics";
import { createPlan, updatePlan } from "@/server/db/queries/plans";
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
    searchFields: ["name"],
    extraConditions,
    extraBindings,
    limit,
    cursor,
    search,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const {
    name,
    description,
    tenantId,
    price,
    currency,
    recurrenceDays,
    benefits,
    roles,
    entityLimits,
    apiRateLimit,
    storageLimitBytes,
    fileCacheLimitBytes,
    planCredits,
    maxConcurrentDownloads,
    maxConcurrentUploads,
    maxDownloadBandwidthMB,
    maxUploadBandwidthMB,
    maxOperationCount,
    isActive,
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
    const plan = await createPlan({
      name: await standardizeField("name", sanitizeString(name)),
      description: sanitizeString(description ?? ""),
      tenantId,
      price: Number(price),
      currency,
      recurrenceDays: Number(recurrenceDays),
      benefits: benefits ?? [],
      roles: roles ?? [],
      entityLimits: entityLimits && Object.keys(entityLimits).length > 0
        ? entityLimits
        : undefined,
      apiRateLimit,
      storageLimitBytes,
      fileCacheLimitBytes,
      planCredits,
      maxConcurrentDownloads,
      maxConcurrentUploads,
      maxDownloadBandwidthMB,
      maxUploadBandwidthMB,
      maxOperationCount: maxOperationCount || undefined,
      isActive,
    });

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
  const body = await req.json();
  const { id, ...data } = body;

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
    const updates: Record<string, unknown> = {};

    const fields = [
      "name",
      "description",
      "price",
      "currency",
      "recurrenceDays",
      "benefits",
      "roles",
      "entityLimits",
      "apiRateLimit",
      "storageLimitBytes",
      "fileCacheLimitBytes",
      "planCredits",
      "maxConcurrentDownloads",
      "maxConcurrentUploads",
      "maxDownloadBandwidthMB",
      "maxUploadBandwidthMB",
      "maxOperationCount",
      "isActive",
    ] as const;

    for (const field of fields) {
      if (data[field] !== undefined) {
        const value = data[field];
        if (
          field === "entityLimits" &&
          (!value ||
            (typeof value === "object" &&
              Object.keys(value as object).length === 0))
        ) {
          updates[field] = null; // will be mapped to NONE in query
        } else {
          updates[field] = field === "name" || field === "description"
            ? await standardizeField(field, sanitizeString(value))
            : value;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const updated = await updatePlan(id, updates);

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
  const body = await req.json();
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
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  getHandler,
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  postHandler,
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
