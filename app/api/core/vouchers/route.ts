import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import {
  deleteVoucher,
  updateVoucherWithCascade,
} from "@/server/db/queries/vouchers";
import { genericCreate, genericList } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import type { Voucher } from "@/src/contracts/voucher";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const result = await genericList<Voucher>({
    table: "voucher",
    searchFields: ["code"],
    limit,
    cursor,
    search,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const {
    code,
    applicableTenantIds,
    applicablePlanIds,
    priceModifier,
    entityLimitModifiers,
    apiRateLimitModifier,
    storageLimitModifier,
    fileCacheLimitModifier,
    maxConcurrentDownloadsModifier,
    maxConcurrentUploadsModifier,
    maxDownloadBandwidthModifier,
    maxUploadBandwidthModifier,
    maxOperationCountModifier,
    creditModifier,
    expiresAt,
  } = body;

  const codeErrors = await validateField("name", code);
  if (codeErrors.length > 0 || !code) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: codeErrors.length > 0
            ? codeErrors
            : ["validation.voucher.codeRequired"],
        },
      },
      { status: 400 },
    );
  }

  if (
    !applicableTenantIds || !Array.isArray(applicableTenantIds) ||
    applicableTenantIds.length === 0
  ) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.tenant.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const voucher = await genericCreate<Voucher>({
      table: "voucher",
    }, {
      code: await standardizeField("name", sanitizeString(code)),
      applicableTenantIds: (applicableTenantIds ?? []).map(
        (id: string) => rid(id),
      ),
      applicablePlanIds: (applicablePlanIds ?? []).map(
        (id: string) => rid(id),
      ),
      priceModifier: Number(priceModifier ?? 0),
      entityLimitModifiers: entityLimitModifiers &&
          Object.keys(entityLimitModifiers).length > 0
        ? entityLimitModifiers
        : undefined,
      apiRateLimitModifier: Number(apiRateLimitModifier ?? 0),
      storageLimitModifier: Number(storageLimitModifier ?? 0),
      fileCacheLimitModifier: Number(fileCacheLimitModifier ?? 0),
      maxConcurrentDownloadsModifier: Number(
        maxConcurrentDownloadsModifier ?? 0,
      ),
      maxConcurrentUploadsModifier: Number(maxConcurrentUploadsModifier ?? 0),
      maxDownloadBandwidthModifier: Number(maxDownloadBandwidthModifier ?? 0),
      maxUploadBandwidthModifier: Number(maxUploadBandwidthModifier ?? 0),
      maxOperationCountModifier: maxOperationCountModifier || undefined,
      creditModifier: Number(creditModifier ?? 0),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    if (!voucher.success) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: voucher.errors },
        },
        { status: 400 },
      );
    }

    const core = Core.getInstance();
    await core.reload();
    core.evictAllSubscriptions();

    return Response.json(
      { success: true, data: voucher.data },
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

/**
 * PUT — updates a voucher with auto-removal cascade:
 * If applicablePlanIds is non-empty after the update, clears voucherId
 * on any subscription whose planId is NOT in the new list.
 * This runs in the same batched query as the voucher update (§7.7).
 */
async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const {
    id,
    code,
    applicableTenantIds,
    applicablePlanIds,
    priceModifier,
    entityLimitModifiers,
    apiRateLimitModifier,
    storageLimitModifier,
    fileCacheLimitModifier,
    maxConcurrentDownloadsModifier,
    maxConcurrentUploadsModifier,
    maxDownloadBandwidthModifier,
    maxUploadBandwidthModifier,
    maxOperationCountModifier,
    creditModifier,
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
    const sets: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (code !== undefined) {
      sets.push("code = $code");
      bindings.code = await standardizeField("name", sanitizeString(code));
    }
    if (applicableTenantIds !== undefined) {
      sets.push("applicableTenantIds = $applicableTenantIds");
      bindings.applicableTenantIds = applicableTenantIds;
    }
    if (applicablePlanIds !== undefined) {
      sets.push("applicablePlanIds = $applicablePlanIds");
      bindings.applicablePlanIds = applicablePlanIds ?? [];
    }
    if (priceModifier !== undefined) {
      sets.push("priceModifier = $priceModifier");
      bindings.priceModifier = Number(priceModifier);
    }
    if (entityLimitModifiers !== undefined) {
      if (
        entityLimitModifiers && Object.keys(entityLimitModifiers).length > 0
      ) {
        sets.push("entityLimitModifiers = $entityLimitModifiers");
        bindings.entityLimitModifiers = entityLimitModifiers;
      } else {
        sets.push("entityLimitModifiers = NONE");
      }
    }
    if (apiRateLimitModifier !== undefined) {
      sets.push("apiRateLimitModifier = $apiRateLimitModifier");
      bindings.apiRateLimitModifier = Number(apiRateLimitModifier);
    }
    if (storageLimitModifier !== undefined) {
      sets.push("storageLimitModifier = $storageLimitModifier");
      bindings.storageLimitModifier = Number(storageLimitModifier);
    }
    if (fileCacheLimitModifier !== undefined) {
      sets.push("fileCacheLimitModifier = $fileCacheLimitModifier");
      bindings.fileCacheLimitModifier = Number(fileCacheLimitModifier);
    }
    if (creditModifier !== undefined) {
      sets.push("creditModifier = $creditModifier");
      bindings.creditModifier = Number(creditModifier);
    }
    if (maxConcurrentDownloadsModifier !== undefined) {
      sets.push(
        "maxConcurrentDownloadsModifier = $maxConcurrentDownloadsModifier",
      );
      bindings.maxConcurrentDownloadsModifier = Number(
        maxConcurrentDownloadsModifier,
      );
    }
    if (maxConcurrentUploadsModifier !== undefined) {
      sets.push("maxConcurrentUploadsModifier = $maxConcurrentUploadsModifier");
      bindings.maxConcurrentUploadsModifier = Number(
        maxConcurrentUploadsModifier,
      );
    }
    if (maxDownloadBandwidthModifier !== undefined) {
      sets.push("maxDownloadBandwidthModifier = $maxDownloadBandwidthModifier");
      bindings.maxDownloadBandwidthModifier = Number(
        maxDownloadBandwidthModifier,
      );
    }
    if (maxUploadBandwidthModifier !== undefined) {
      sets.push("maxUploadBandwidthModifier = $maxUploadBandwidthModifier");
      bindings.maxUploadBandwidthModifier = Number(maxUploadBandwidthModifier);
    }
    if (maxOperationCountModifier !== undefined) {
      sets.push("maxOperationCountModifier = $maxOperationCountModifier");
      bindings.maxOperationCountModifier = maxOperationCountModifier;
    }
    if (expiresAt !== undefined) {
      sets.push("expiresAt = $expiresAt");
      bindings.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    if (sets.length === 0) {
      return Response.json({ success: true, data: null });
    }

    // Auto-removal cascade (§7.7): if applicablePlanIds was updated and is non-empty,
    // strip voucherId from subscriptions whose planId is no longer in the list.
    // Same for applicableTenantIds — strip from subscriptions whose companyId
    // is no longer in the list.
    const shouldCascadePlans = applicablePlanIds !== undefined &&
      Array.isArray(applicablePlanIds) &&
      applicablePlanIds.length > 0;

    const shouldCascadeCompanies = applicableTenantIds !== undefined &&
      Array.isArray(applicableTenantIds) &&
      applicableTenantIds.length > 0;

    const updated = await updateVoucherWithCascade(
      id,
      sets,
      bindings,
      shouldCascadePlans,
      shouldCascadeCompanies,
    );

    const core = Core.getInstance();
    await core.reload();
    core.evictAllSubscriptions();

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
    await deleteVoucher(id);

    const core = Core.getInstance();
    await core.reload();
    core.evictAllSubscriptions();

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
