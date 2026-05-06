import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { getFS } from "@/server/utils/fs";
import {
  fetchSubscriptionAndCreditBalance,
  getCoreCreditExpenses,
} from "@/server/db/queries/credits";
import { get, limitsMerger } from "@/server/utils/cache";
import type { Tenant } from "@/src/contracts/tenant";
import type {
  UsageData,
  UsageTenantFilter,
  UsageTenantResult,
} from "@/src/contracts/high-level/usage";

function validationError(
  message: string,
  status = 400,
): Response {
  return Response.json(
    { success: false, error: { code: "VALIDATION", message } },
    { status },
  );
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const isSuperuser = ctx.tenantContext.roles.includes("superuser");
  const mode = url.searchParams.get("mode");
  const isCore = mode === "core" && isSuperuser;

  const startDate = url.searchParams.get("startDate") ??
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
  const endDate = url.searchParams.get("endDate") ??
    new Date().toISOString().slice(0, 10);

  let tenantFilters: UsageTenantFilter[];

  if (isCore) {
    // Core mode: parse tenants from query param
    const tenantsParam = url.searchParams.get("tenants");
    if (tenantsParam) {
      try {
        tenantFilters = JSON.parse(tenantsParam);
      } catch {
        return validationError("json.invalid");
      }
      if (!Array.isArray(tenantFilters)) {
        return validationError("json.invalid");
      }
    } else {
      tenantFilters = [];
    }
  } else {
    // Tenant mode: company+system from context
    const companyId = ctx.tenantContext.tenant.companyId;
    const systemId = ctx.tenantContext.tenant.systemId;

    if (!companyId || !systemId) {
      return validationError("validation.usage.companyAndSystem");
    }

    const actorsParam = url.searchParams.get("actors");
    const actorIds = actorsParam
      ? actorsParam.split(",").filter(Boolean)
      : undefined;

    tenantFilters = [{ companyId, systemId, actorIds }];
  }

  // Build Tenant vector for getCoreCreditExpenses (per-actor granularity)
  const tenantVector: Tenant[] = [];

  for (const filter of tenantFilters) {
    if (!filter.companyId || !filter.systemId) continue;

    // Non-superuser scope check
    if (
      !isSuperuser && (
        filter.companyId !== ctx.tenantContext.tenant.companyId ||
        filter.systemId !== ctx.tenantContext.tenant.systemId
      )
    ) {
      return validationError("validation.usage.tenantScope", 403);
    }

    if (filter.actorIds && filter.actorIds.length > 0) {
      for (const actorId of filter.actorIds) {
        tenantVector.push({
          companyId: filter.companyId,
          systemId: filter.systemId,
          actorId,
        });
      }
    } else {
      tenantVector.push({
        companyId: filter.companyId,
        systemId: filter.systemId,
      });
    }
  }

  // Fetch per-tenant results (subscription + storage)
  const tenants: UsageTenantResult[] = [];
  const fs = await getFS();

  for (const filter of tenantFilters) {
    if (!filter.companyId || !filter.systemId) continue;

    const tenant: Tenant = {
      companyId: filter.companyId,
      systemId: filter.systemId,
    };

    // Resolve subscription + credit balance (company+system level)
    let subscription: UsageTenantResult["subscription"] = null;
    try {
      const [subRows] = await fetchSubscriptionAndCreditBalance(tenant);
      const sub = subRows[0];
      if (sub) {
        subscription = {
          remainingPlanCredits: sub.remainingPlanCredits ?? 0,
          purchasedCredits: sub.purchasedCredits ?? 0,
          remainingOperationCount: sub.remainingOperationCount ?? null,
        };
      }
    } catch {
      // Subscription may not exist — null is fine
    }

    // Resolve limitBytes (same for all entries in this filter)
    let limitBytes = 0;
    try {
      const limits = await get(
        { systemId: filter.systemId, companyId: filter.companyId },
        "limits",
        limitsMerger,
      ) as any;
      limitBytes = limits?.storageLimitBytes ?? 0;
    } catch {
      // Limits unavailable — 0 is fine
    }

    const coreData = await get(undefined, "core-data") as any;
    const systemSlug = coreData?.systemsById?.[filter.systemId]?.slug;

    // Determine per-actor vs company+system scope
    const hasActors = filter.actorIds && filter.actorIds.length > 0;

    if (hasActors) {
      // Per-actor results: each actor gets its own storage from path [companyId, systemSlug, actorId]
      for (const actorId of filter.actorIds!) {
        let usedBytes = 0;
        try {
          if (systemSlug) {
            const listing = await fs.readDir({
              path: [filter.companyId, systemSlug, actorId],
            });
            usedBytes = listing.size;
          }
        } catch {
          // Storage unavailable — 0 is fine
        }

        tenants.push({
          companyId: filter.companyId,
          systemId: filter.systemId,
          actorId,
          storage: { usedBytes, limitBytes },
          subscription,
        });
      }
    } else {
      // Company+system level: path [companyId, systemSlug]
      let usedBytes = 0;
      try {
        if (systemSlug) {
          const listing = await fs.readDir({
            path: [filter.companyId, systemSlug],
          });
          usedBytes = listing.size;
        }
      } catch {
        // Storage unavailable — 0 is fine
      }

      tenants.push({
        companyId: filter.companyId,
        systemId: filter.systemId,
        storage: { usedBytes, limitBytes },
        subscription,
      });
    }
  }

  // Fetch aggregated credit expenses
  const creditExpenses = tenantVector.length > 0
    ? await getCoreCreditExpenses({ startDate, endDate, tenants: tenantVector })
    : [];

  const data: UsageData = { tenants, creditExpenses };
  return Response.json({ success: true, data });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  getHandler,
);
