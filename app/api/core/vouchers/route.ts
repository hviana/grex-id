import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import {
  createVoucherWithResourceLimit,
  deleteVoucher,
  updateVoucherWithCascade,
} from "@/server/db/queries/vouchers";
import { genericList } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
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

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
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
    const voucher = await createVoucherWithResourceLimit({
      name: await standardizeField("name", sanitizeString(name)),
      applicableTenantIds: applicableTenantIds ?? [],
      applicablePlanIds: applicablePlanIds ?? [],
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      resourceLimits: resourceLimits ?? undefined,
    });

    if (!voucher) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    const core = Core.getInstance();
    await core.reload();
    core.evictAllSubscriptions();

    return Response.json(
      { success: true, data: voucher },
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
 * PUT — updates a voucher and its resource_limit with auto-removal cascade.
 */
async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
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
    const voucherSets: string[] = [];
    const rlSets: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (name !== undefined) {
      voucherSets.push("name = $name");
      bindings.name = await standardizeField("name", sanitizeString(name));
    }
    if (applicableTenantIds !== undefined) {
      voucherSets.push("applicableTenantIds = $applicableTenantIds");
      bindings.applicableTenantIds = applicableTenantIds;
    }
    if (applicablePlanIds !== undefined) {
      voucherSets.push("applicablePlanIds = $applicablePlanIds");
      bindings.applicablePlanIds = applicablePlanIds ?? [];
    }
    if (expiresAt !== undefined) {
      voucherSets.push("expiresAt = $expiresAt");
      bindings.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }

    // Resource limit fields (modifier values)
    if (resourceLimits !== undefined) {
      const rl = resourceLimits as Record<string, unknown>;
      if (rl.entityLimits !== undefined) {
        rlSets.push("entityLimits = $entityLimits");
        bindings.entityLimits = rl.entityLimits || undefined;
      }
      if (rl.apiRateLimit !== undefined) {
        rlSets.push("apiRateLimit = $apiRateLimit");
        bindings.apiRateLimit = Number(rl.apiRateLimit);
      }
      if (rl.storageLimitBytes !== undefined) {
        rlSets.push("storageLimitBytes = $storageLimitBytes");
        bindings.storageLimitBytes = Number(rl.storageLimitBytes);
      }
      if (rl.fileCacheLimitBytes !== undefined) {
        rlSets.push("fileCacheLimitBytes = $fileCacheLimitBytes");
        bindings.fileCacheLimitBytes = Number(rl.fileCacheLimitBytes);
      }
      if (rl.credits !== undefined) {
        rlSets.push("credits = $credits");
        bindings.credits = Number(rl.credits);
      }
      if (rl.maxConcurrentDownloads !== undefined) {
        rlSets.push("maxConcurrentDownloads = $maxConcurrentDownloads");
        bindings.maxConcurrentDownloads = Number(rl.maxConcurrentDownloads);
      }
      if (rl.maxConcurrentUploads !== undefined) {
        rlSets.push("maxConcurrentUploads = $maxConcurrentUploads");
        bindings.maxConcurrentUploads = Number(rl.maxConcurrentUploads);
      }
      if (rl.maxDownloadBandwidthMB !== undefined) {
        rlSets.push("maxDownloadBandwidthMB = $maxDownloadBandwidthMB");
        bindings.maxDownloadBandwidthMB = Number(rl.maxDownloadBandwidthMB);
      }
      if (rl.maxUploadBandwidthMB !== undefined) {
        rlSets.push("maxUploadBandwidthMB = $maxUploadBandwidthMB");
        bindings.maxUploadBandwidthMB = Number(rl.maxUploadBandwidthMB);
      }
      if (rl.maxOperationCountByResourceKey !== undefined) {
        rlSets.push(
          "maxOperationCountByResourceKey = $maxOperationCountByResourceKey",
        );
        bindings.maxOperationCountByResourceKey =
          rl.maxOperationCountByResourceKey;
      }
      if (rl.creditLimitByResourceKey !== undefined) {
        rlSets.push("creditLimitByResourceKey = $creditLimitByResourceKey");
        bindings.creditLimitByResourceKey = rl.creditLimitByResourceKey;
      }
    }

    if (voucherSets.length === 0 && rlSets.length === 0) {
      return Response.json({ success: true, data: null });
    }

    const shouldCascadePlans = applicablePlanIds !== undefined &&
      Array.isArray(applicablePlanIds) &&
      applicablePlanIds.length > 0;

    const shouldCascadeTenants = applicableTenantIds !== undefined &&
      Array.isArray(applicableTenantIds) &&
      applicableTenantIds.length > 0;

    const updated = await updateVoucherWithCascade(
      id,
      voucherSets,
      rlSets,
      bindings,
      shouldCascadePlans,
      shouldCascadeTenants,
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
