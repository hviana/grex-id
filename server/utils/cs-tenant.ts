import "server-only";

import type { Tenant } from "@/src/contracts/tenant";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";

/**
 * Returns a company-system tenant selector from the request context.
 *
 * Use this for **company-system scoped** entities (locations, tags, groups,
 * subscriptions, etc.) when calling generic CRUD helpers. The generics layer
 * resolves the company-system tenant row automatically via subquery.
 *
 * For creates, pair with `allowCreateCallerTenant: true`.
 *
 * Do NOT use for actor-scoped entities (connected_service, api_token,
 * usage_record) or when a concrete tenant record ID is required
 * (genericAssociate, custom queries storing tenantIds).
 */
export function csTenant(ctx: RequestContext): Tenant {
  return {
    companyId: ctx.tenantContext.tenant.companyId,
    systemId: ctx.tenantContext.tenant.systemId,
  };
}
