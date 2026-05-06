import "server-only";

import { getDb, rid } from "../connection.ts";
import type { Tenant } from "@/src/contracts/tenant";
import type { CoreCreditExpenseRow } from "@/src/contracts/high-level/query-results";

// ============================================================================
// Tenant resolution helper — resolves or creates company-system tenant
// ============================================================================

/**
 * Builds SurrealQL LET statements to resolve the company-system tenant row.
 * Finds the tenant row with actorId=NONE for the given company + system.
 * If none exists, creates one. Produces a `$csTenantId` variable available
 * in subsequent statements.
 *
 * Pseudocode:
 *   LET $csTenantId = SELECT id FROM tenant WHERE !actorId AND companyId=$c AND systemId=$s LIMIT 1
 *   IF $csTenantId = NONE:
 *     CREATE tenant SET actorId=NONE, companyId=$c, systemId=$s, isOwner=false
 *     $csTenantId = new id
 */
function resolveCompanySystemTenantLET(): string {
  return `
    LET $csTenantId = (SELECT VALUE id FROM tenant
      WHERE !actorId AND companyId = $companyId AND systemId = $systemId LIMIT 1)[0];
    IF $csTenantId = NONE {
      LET $_csCreated = (CREATE tenant SET actorId = NONE, companyId = $companyId, systemId = $systemId, isOwner = false);
      LET $csTenantId = $_csCreated[0].id;
    };`;
}

/**
 * Builds bindings for company-system tenant resolution.
 */
function companySystemBindings(tenant: Tenant): Record<string, unknown> {
  if (!tenant.companyId) throw new Error("tenant.companyId required");
  if (!tenant.systemId) throw new Error("tenant.systemId required");
  return {
    companyId: rid(tenant.companyId),
    systemId: rid(tenant.systemId),
  };
}

// ============================================================================
// VISUALIZATION — no side effects, read-only
// ============================================================================

/**
 * fetchSubscriptionAndCreditBalance — READ-ONLY visualization query.
 *
 * Loads the active subscription for a company+system pair. Used by billing
 * pages and admin views for displaying plan status, remaining credits, and
 * operation counts.
 *
 * Does NOT set any flags, does NOT deduct anything.
 *
 * Pseudocode:
 *   RESOLVE company-system tenant (find or create)
 *   SELECT subscription WHERE tenantIds CONTAINS $csTenantId AND status="active"
 *
 * @param tenant - must have companyId and systemId. tenant.id NOT required.
 */
export async function fetchSubscriptionAndCreditBalance(
  tenant: Tenant,
): Promise<
  [
    {
      id: string;
      remainingPlanCredits: number;
      purchasedCredits: number;
      remainingOperationCount: Record<string, number> | null;
      creditAlertSent: boolean;
      operationCountAlertSent: Record<string, boolean> | null;
      autoRechargeEnabled: boolean;
      autoRechargeAmount: number;
      autoRechargeInProgress: boolean;
      tenantIds: string;
    }[],
  ]
> {
  const db = await getDb();
  return db.query(
    `${resolveCompanySystemTenantLET()}
     LET $sub = (SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
                        autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress, tenantIds
                 FROM subscription
                 WHERE tenantIds CONTAINS $csTenantId AND status = "active"
                 LIMIT 1)[0];
     LET $purchasedCredits = (SELECT math::sum(value) AS balance FROM usage_record
       WHERE tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId)
       AND resourceKey = "credits" GROUP ALL)[0].balance ?? 0;
     SELECT id, remainingPlanCredits, $purchasedCredits AS purchasedCredits,
            remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            tenantIds
     FROM $sub;`,
    companySystemBindings(tenant),
  );
}

// ============================================================================
// ACTOR LIMITS — read-only
// ============================================================================

/**
 * fetchActorOperationCap — READ-ONLY actor-level limit lookup.
 *
 * Loads the actor's per-resourceKey caps from their resource_limit:
 * - maxOperationCountByResourceKey: per-resource operation count caps
 * - creditLimitByResourceKey: per-resource credit spending caps
 *
 * Per-actor usage is tracked via usage_record rows scoped to the actor's
 * tenant (tenant.id), not a separate table.
 *
 * @param tenant - must have actorId (the api_token or user)
 */
export async function fetchActorOperationCap(params: {
  tenant: Tenant;
}): Promise<
  [
    {
      maxOperationCountByResourceKey: Record<string, number> | null;
      creditLimitByResourceKey: Record<string, number> | null;
    }[],
  ]
> {
  if (!params.tenant.actorId) throw new Error("tenant.actorId required");

  const db = await getDb();
  return db.query(
    `SELECT resourceLimitId.maxOperationCountByResourceKey,
            resourceLimitId.creditLimitByResourceKey
     FROM api_token WHERE id = $actorRid LIMIT 1
     FETCH resourceLimitId;`,
    { actorRid: rid(params.tenant.actorId) },
  );
}

// ============================================================================
// ALERT HELPERS — set flag + return owner info for notification dispatch
// ============================================================================

/**
 * setCreditAlertAndFetchOwner — Sets creditAlertSent=true on the subscription
 * and returns owner identification for the insufficient-credit notification.
 *
 * Logic (one batched query):
 * 1. Resolve company-system tenant from companyId + systemId
 * 2. Check if creditAlertSent is already true on the active subscription
 * 3. If not, set it to true
 * 4. Resolve the company owner (tenant with isOwner=true, no systemId)
 * 5. Fetch owner's name (from profile) and locale
 * 6. Fetch system name and slug
 *
 * @param tenant - must have companyId and systemId. tenant.id NOT required.
 * @returns alerted=true if flag was just set (was false), false if already sent.
 *          Always returns owner/system info regardless of alert state.
 */
export async function setCreditAlertAndFetchOwner(params: {
  tenant: Tenant;
}): Promise<{
  alerted: boolean;
  ownerName: string;
  ownerLocale: string | undefined;
  ownerId: string;
  systemName: string;
  systemSlug: string;
}> {
  const db = await getDb();
  const result = await db.query<
    [
      { creditAlertSent: boolean }[],
      unknown[],
      { id: string; name: string; locale: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `${resolveCompanySystemTenantLET()}
     LET $alreadySent = (SELECT VALUE creditAlertSent FROM subscription
       WHERE tenantIds CONTAINS $csTenantId AND status = "active" LIMIT 1)[0];
     IF $alreadySent != true {
       UPDATE subscription SET creditAlertSent = true
         WHERE tenantIds CONTAINS $csTenantId AND status = "active";
     };
     LET $ownerId = (SELECT VALUE actorId FROM tenant WHERE companyId = $companyId AND !systemId AND isOwner = true LIMIT 1)[0];
     SELECT id, profileId.name AS name, profileId.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    companySystemBindings(params.tenant),
  );

  const alreadySent = result[0]?.[0]?.creditAlertSent === true;
  const user = result[2]?.[0];
  const system = result[3]?.[0];

  return {
    alerted: !alreadySent,
    ownerName: user?.name ?? "",
    ownerLocale: user?.locale,
    ownerId: user?.id ? String(user.id) : "",
    systemName: system?.name ?? "",
    systemSlug: system?.slug ?? "",
  };
}

/**
 * setOperationCountAlertAndFetchOwner — Sets the operationCountAlertSent flag
 * for a specific resourceKey on the subscription and returns owner
 * identification for the operation-count-limit notification.
 *
 * Logic (one batched query):
 * 1. Resolve company-system tenant from companyId + systemId
 * 2. Check if operationCountAlertSent[resourceKey] is already true
 * 3. If not, merge { [resourceKey]: true } into the map
 * 4. Resolve the company owner and system info
 *
 * @param tenant - must have companyId and systemId. tenant.id NOT required.
 * @param resourceKey - the resource that hit the operation limit
 * @returns alerted=true if flag was just set (was false), false if already sent.
 *          Always returns owner/system info regardless of alert state.
 */
export async function setOperationCountAlertAndFetchOwner(params: {
  tenant: Tenant;
  resourceKey: string;
}): Promise<{
  alerted: boolean;
  ownerName: string;
  ownerLocale: string | undefined;
  ownerId: string;
  systemName: string;
  systemSlug: string;
}> {
  const db = await getDb();
  const result = await db.query<
    [
      { operationCountAlertSent: Record<string, boolean> | null }[],
      unknown[],
      { id: string; name: string; locale: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `${resolveCompanySystemTenantLET()}
     LET $currentAlerts = (SELECT VALUE operationCountAlertSent FROM subscription
       WHERE tenantIds CONTAINS $csTenantId AND status = "active" LIMIT 1)[0];
     LET $alreadySent = IF $currentAlerts != NONE AND $currentAlerts != null
       THEN IF $currentAlerts[$resourceKey] = true THEN true ELSE false END
       ELSE false END;
     IF $alreadySent != true {
       UPDATE subscription SET operationCountAlertSent = object::extend(
         IF operationCountAlertSent IS NONE OR operationCountAlertSent = false THEN {} ELSE operationCountAlertSent END,
         { [$resourceKey]: true }
       ) WHERE tenantIds CONTAINS $csTenantId AND status = "active";
     };
     LET $ownerId = (SELECT VALUE actorId FROM tenant WHERE companyId = $companyId AND !systemId AND isOwner = true LIMIT 1)[0];
     SELECT id, profileId.name AS name, profileId.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profileId;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      ...companySystemBindings(params.tenant),
      resourceKey: params.resourceKey,
    },
  );

  const alreadySent =
    result[0]?.[0]?.operationCountAlertSent?.[params.resourceKey] === true;
  const user = result[2]?.[0];
  const system = result[3]?.[0];

  return {
    alerted: !alreadySent,
    ownerName: user?.name ?? "",
    ownerLocale: user?.locale,
    ownerId: user?.id ? String(user.id) : "",
    systemName: system?.name ?? "",
    systemSlug: system?.slug ?? "",
  };
}

// ============================================================================
// CORE AGGREGATION — usage_record based expense reporting
// ============================================================================

/**
 * getCoreCreditExpenses — Aggregates usage_record data by resourceKey.
 *
 * Returns totalAmount (sum of value) and totalCount (sum of counts) grouped
 * by resourceKey within a date range.
 *
 * Tenant filtering logic:
 * - tenants undefined or empty → compute everything (no tenant filter)
 * - tenants provided → for each tenant, resolve the matching tenant rows:
 *   - companyId only → all tenant rows for that company
 *   - systemId only → all tenant rows for that system
 *   - companyId + systemId → tenant rows matching both
 *   - companyId + systemId + actorId → tenant rows matching all three
 *   All resolved tenant IDs are combined into one CONTAINSANY filter.
 *
 * Period filtering: usage_record.period is "YYYY-MM". The startDate/endDate
 * range is converted to cover all matching periods.
 *
 * ONE batched db.query() call.
 */
export async function getCoreCreditExpenses(params: {
  startDate: string;
  endDate: string;
  tenants?: Tenant[];
}): Promise<CoreCreditExpenseRow[]> {
  const { startDate, endDate, tenants } = params;
  const db = await getDb();

  // Build the list of periods covered by the date range (YYYY-MM)
  const start = new Date(startDate);
  const end = new Date(endDate);
  const periods: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    periods.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`,
    );
    cur.setMonth(cur.getMonth() + 1);
  }

  const bindings: Record<string, unknown> = {
    periods,
  };

  // Resolve tenant rows for each tenant in the vector.
  // Build WHERE conditions per tenant combination, then combine.
  const tenantConditions: string[] = [];
  if (tenants && tenants.length > 0) {
    for (let i = 0; i < tenants.length; i++) {
      const t = tenants[i];
      const prefix = `t${i}`;
      const parts: string[] = [];

      if (t.companyId) {
        bindings[`${prefix}_companyId`] = rid(t.companyId);
        parts.push("companyId = $" + prefix + "_companyId");
      }
      if (t.systemId) {
        bindings[`${prefix}_systemId`] = rid(t.systemId);
        parts.push("systemId = $" + prefix + "_systemId");
      }
      if (t.actorId) {
        bindings[`${prefix}_actorId`] = rid(t.actorId);
        parts.push("actorId = $" + prefix + "_actorId");
      }

      if (parts.length === 0) continue;

      tenantConditions.push(
        `tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE ${
          parts.join(" AND ")
        })`,
      );
    }
  }

  const where = tenantConditions.length > 0
    ? ` WHERE period IN $periods AND (${
      tenantConditions.map((c) => `(${c})`).join(" OR ")
    })`
    : ` WHERE period IN $periods`;

  const result = await db.query<[CoreCreditExpenseRow[]]>(
    `SELECT resourceKey, math::sum(value) AS totalAmount, math::sum(counts) AS totalCount
     FROM usage_record${where}
     GROUP BY resourceKey
     ORDER BY totalAmount DESC`,
    bindings,
  );
  return result[0] ?? [];
}

// ============================================================================
// UNIFIED DEDUCTION — the core credit consumption function
// ============================================================================

/**
 * queryCreditExpenses — Unified credit deduction and expense tracking.
 *
 * SINGLE function handling all credit consumption in ONE batched db.query().
 * All tracking uses `usage_record` — there is no separate expense table.
 *
 * ## Data model
 *
 * The actor is IN the tenant. Each `usage_record` row is scoped by `tenantIds`
 * which links to a single tenant row. When actorId is present, the actor's
 * tenant (`tenant.id`) already encodes companyId + systemId — no need for a
 * separate company-system tenant reference. When no actorId, the
 * company-system tenant (`$csTenantId`) is used.
 *
 * Aggregate queries across a company+system use CONTAINSANY to match all
 * tenant rows for that company+system combination.
 *
 * ## Prerequisites
 *
 * 1. **Plan resolution**: a single validation query checks that a tenant exists
 *    for `companyId + systemId` (actorId is NOT filtered) AND has an active
 *    subscription. No tenant creation — purely read-only validation.
 * 2. **Company-system tenant**: resolved (found or created) via
 *    `resolveCompanySystemTenantLET()`. Used for subscription lookup only.
 * 3. **Active subscription required**: no active sub → denied
 *    (`source: "insufficient"`).
 *
 * ## Limit resolution (plan + voucher merging)
 *
 * Both the plan and (optionally) the voucher reference a `resource_limit` row:
 * - **Plan** `resource_limit` → **absolute** values for
 *   `maxOperationCountByResourceKey` and `creditLimitByResourceKey`.
 * - **Voucher** `resource_limit` → **modifier** (positive increments, negative
 *   decrements) applied on top of the plan's absolute values.
 * - **Merged value** = `plan[key] ?? 0 + voucher[key] ?? 0`.
 *   - Key absent from BOTH maps → `NONE` (no limit — unlimited).
 *   - Key present in either map, merged ≤ 0 → **blocked**.
 *   - Key present in either map, merged > 0 → **cap** to enforce.
 * - The `credits` field in `resource_limit` is **ignored** for plan/voucher.
 *   Available credits come exclusively from `subscription.remainingPlanCredits`
 *   + the purchased-credits pool (`usage_record` where `resourceKey = "credits"`).
 *
 * ## Subscription-level checks (aggregate across company+system)
 *
 * 1. **Operation count** (`maxOperationCountByResourceKey`): sum of
 *    `usage_record.counts` for the resourceKey within the subscription period
 *    across ALL tenants for the company+system, compared against the merged cap.
 *    Missing key → no limit.
 * 2. **Credit spending** (`creditLimitByResourceKey`): sum of
 *    `usage_record.value` for the resourceKey within the period across ALL
 *    tenants for the company+system, compared against the merged cap.
 *    Missing key → no limit.
 * 3. **Available credits**: `remainingPlanCredits + purchasedCredits < amount`
 *    → insufficient. Credits are deducted from plan first, then purchased.
 *
 * ## Actor-level checks (usage_record scoped to actor's tenant, when present)
 *
 * The actor's `resource_limit` is resolved (api_token first, then user).
 * Per-actor usage is tracked via `usage_record` rows scoped to the actor's
 * tenant (`tenant.id`). All fields: missing/undefined = no limit, 0 = blocked.
 *
 * 1. **Operation count** (`maxOperationCountByResourceKey[resourceKey]`):
 *    `usage_record.counts` within the period vs cap.
 * 2. **Per-resource credit spending** (`creditLimitByResourceKey[resourceKey]`):
 *    `usage_record.value` for the resourceKey within the period vs cap.
 * 3. **Global credit spending** (`credits` field): `usage_record.value`
 *    across ALL resourceKeys within the period vs cap.
 *
 * ## On successful deduction
 *
 * 1. `UPSERT usage_record` for the resourceKey (`counts += 1, value += amount`)
 *    scoped to the actor's tenant (`$tenantId`) when actorId present, or the
 *    company-system tenant (`$csTenantId`) when not.
 * 2. If purchased credits used: `UPSERT usage_record` for
 *    `resourceKey="credits"` (`value -= remainder`) with same tenant scoping.
 * 3. `UPDATE subscription` — decrement `remainingPlanCredits` and, if the
 *    merged op-limit is defined, decrement `remainingOperationCount[key]`.
 *
 * @param tenant - must have companyId and systemId. actorId optional.
 *   When actorId is present, tenant.id is required (the actor's tenant row).
 * @param resourceKey - identifies the resource being consumed.
 * @param amount - credit amount to consume.
 * @returns result with success status, source, and remaining balances.
 */
export async function queryCreditExpenses(params: {
  tenant: Tenant;
  resourceKey: string;
  amount: number;
}): Promise<{
  success: boolean;
  source: "plan" | "purchased" | "insufficient" | "operationLimit";
  resourceKey: string;
  actorName: string;
  systemName: string;
  companyName: string;
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
  autoRechargeTriggered?: boolean;
  subscriptionId?: string;
}> {
  const { tenant, resourceKey, amount } = params;

  if (!tenant.companyId) throw new Error("tenant.companyId required");
  if (!tenant.systemId) throw new Error("tenant.systemId required");
  if (tenant.actorId && !tenant.id) {
    throw new Error("tenant.id required when actorId is present");
  }

  const db = await getDb();

  // Actor-specific LET variables (only included when actorId exists).
  // Per-actor tracking uses usage_record scoped to the actor's tenant ($tenantId).
  // The actor IS the tenant — no separate actorId column needed.
  const actorLETs = tenant.actorId
    ? `
       // Resolve actor's resource_limit (api_token first, then user)
       LET $actorRlFromToken = (SELECT VALUE resourceLimitId FROM api_token WHERE id = $actorRid LIMIT 1)[0];
       LET $actorRlId = IF $actorRlFromToken != NONE THEN $actorRlFromToken
         ELSE (SELECT VALUE resourceLimitId FROM user WHERE id = $actorRid LIMIT 1)[0] END;
       LET $actorRl = IF $actorRlId != NONE THEN (SELECT maxOperationCountByResourceKey, creditLimitByResourceKey, credits FROM resource_limit WHERE id = $actorRlId)[0] ELSE NONE END;

       // Actor maxOperationCountByResourceKey: missing = no limit, 0 = block
       LET $actorOpVal = IF $actorRl != NONE AND $actorRl.maxOperationCountByResourceKey != NONE THEN $actorRl.maxOperationCountByResourceKey[$resourceKey] ELSE NONE END;
       LET $actorCurrentOpCount = (SELECT math::sum(counts) AS c FROM usage_record
         WHERE tenantIds CONTAINS $tenantId AND resourceKey = $resourceKey
         AND period >= $subPeriodStart AND period <= $subPeriodEnd
         GROUP ALL)[0].c ?? 0;
       LET $actorOpsBlocked = IF $actorOpVal = NONE THEN false
         ELSE IF $actorOpVal <= 0 THEN true
         ELSE IF $actorCurrentOpCount >= $actorOpVal THEN true
         ELSE false END END;

       // Actor creditLimitByResourceKey: missing = no limit, 0 = block
       LET $actorCreditLimitVal = IF $actorRl != NONE AND $actorRl.creditLimitByResourceKey != NONE THEN $actorRl.creditLimitByResourceKey[$resourceKey] ELSE NONE END;
       LET $actorPerResCreditSpent = (SELECT math::sum(value) AS v FROM usage_record
         WHERE tenantIds CONTAINS $tenantId AND resourceKey = $resourceKey
         AND period >= $subPeriodStart AND period <= $subPeriodEnd
         GROUP ALL)[0].v ?? 0;
       LET $actorPerResCreditBlocked = IF $actorCreditLimitVal = NONE THEN false
         ELSE IF $actorCreditLimitVal <= 0 THEN true
         ELSE IF ($actorPerResCreditSpent + $amount) > $actorCreditLimitVal THEN true
         ELSE false END END;

       // Actor global credit cap (credits field): missing = no limit, 0 = block
       LET $actorGlobalCreditVal = IF $actorRl != NONE THEN $actorRl.credits ELSE NONE END;
       LET $actorGlobalCreditSpent = (SELECT math::sum(value) AS v FROM usage_record
         WHERE tenantIds CONTAINS $tenantId
         AND period >= $subPeriodStart AND period <= $subPeriodEnd
         GROUP ALL)[0].v ?? 0;
       LET $actorGlobalCreditBlocked = IF $actorGlobalCreditVal = NONE THEN false
         ELSE IF $actorGlobalCreditVal <= 0 THEN true
         ELSE IF ($actorGlobalCreditSpent + $amount) > $actorGlobalCreditVal THEN true
         ELSE false END END;

       LET $actorCreditBlocked = $actorPerResCreditBlocked OR $actorGlobalCreditBlocked;
       LET $actorBlocked = $actorOpsBlocked OR $actorCreditBlocked;
       LET $actorNameVal = (SELECT VALUE profileId.name FROM user WHERE id = $actorRid LIMIT 1 FETCH profileId)[0];`
    : `LET $actorOpsBlocked = false;
       LET $actorCreditBlocked = false;
       LET $actorBlocked = false;
       LET $actorNameVal = "";`;

  // Single tenant reference for usage_record: actor's tenant when present
  // (already encodes companyId + systemId), otherwise company-system tenant.
  const tenantIdsSet = tenant.actorId
    ? `<set>[$tenantId]`
    : `<set>[$csTenantId]`;

  // WHERE clause for UPSERT — must match the tenant actually in the set.
  const upsertWhereTenant = tenant.actorId
    ? `tenantIds CONTAINS $tenantId`
    : `tenantIds CONTAINS $csTenantId`;

  const result = await db.query<
    [
      // 0: RETURN result object
      Record<string, unknown>,
    ]
  >(
    // ── PLAN RESOLUTION (validation) ───────────────────────────────────
    // Single query: verify a tenant exists for companyId + systemId (actorId
    // is NOT filtered — any value is fine) AND it has an active subscription.
    // This is a READ-ONLY validation — no tenant creation.
    `LET $hasActivePlan = (SELECT VALUE id FROM subscription
       WHERE status = "active"
       AND tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId)
       LIMIT 1)[0] != NONE;

     // ── RESOLVE COMPANY-SYSTEM TENANT (find or create) ──────────────────
     // Used for subscription lookup (subscription.tenantIds references this row).
     ${resolveCompanySystemTenantLET()}

     // ── LOAD SUBSCRIPTION AND PLAN DATA ─────────────────────────────────
     LET $sub = (SELECT id, remainingPlanCredits,
            remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            planId, voucherId, currentPeriodStart, currentPeriodEnd
     FROM subscription
     WHERE tenantIds CONTAINS $csTenantId AND status = "active"
     LIMIT 1)[0];

     LET $periodStart = $sub.currentPeriodStart ?? time::now();
     LET $periodEnd = $sub.currentPeriodEnd ?? time::now();
     LET $planCredits = $sub.remainingPlanCredits ?? 0;

     // Purchased credit balance (aggregate across all tenants for company+system)
     LET $purchasedCredits = (SELECT math::sum(value) AS balance FROM usage_record
       WHERE tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId)
       AND resourceKey = "credits" GROUP ALL)[0].balance ?? 0;

     LET $totalAvailable = $planCredits + $purchasedCredits;

     // ── PLAN RESOURCE LIMIT (absolute values) ──────────────────────────
     LET $planRlId = IF $sub != NONE THEN (SELECT VALUE resourceLimitId FROM plan WHERE id = $sub.planId LIMIT 1)[0] ELSE NONE END;
     LET $planRl = IF $planRlId != NONE THEN (SELECT maxOperationCountByResourceKey, creditLimitByResourceKey FROM resource_limit WHERE id = $planRlId)[0] ELSE NONE END;

     // ── VOUCHER RESOURCE LIMIT (modifier: + increments, - decrements) ──
     LET $voucherRlId = IF $sub != NONE AND $sub.voucherId != NONE THEN (SELECT VALUE resourceLimitId FROM voucher WHERE id = $sub.voucherId LIMIT 1)[0] ELSE NONE END;
     LET $voucherRl = IF $voucherRlId != NONE THEN (SELECT maxOperationCountByResourceKey, creditLimitByResourceKey FROM resource_limit WHERE id = $voucherRlId)[0] ELSE NONE END;

     // ── MERGED LIMITS ──────────────────────────────────────────────────
     // Plan = absolute. Voucher = modifier added on top.
     // Key absent from BOTH maps → NONE (no limit — unlimited).
     // Key present in either, merged ≤ 0 → blocked. Merged > 0 → cap.

     // maxOperationCountByResourceKey
     LET $planOpVal = IF $planRl != NONE AND $planRl.maxOperationCountByResourceKey != NONE THEN $planRl.maxOperationCountByResourceKey[$resourceKey] ELSE NONE END;
     LET $voucherOpVal = IF $voucherRl != NONE AND $voucherRl.maxOperationCountByResourceKey != NONE THEN $voucherRl.maxOperationCountByResourceKey[$resourceKey] ELSE NONE END;
     LET $mergedOpLimit = IF $planOpVal = NONE AND $voucherOpVal = NONE THEN NONE ELSE ($planOpVal ?? 0) + ($voucherOpVal ?? 0) END;

     // creditLimitByResourceKey
     LET $planCreditLimitVal = IF $planRl != NONE AND $planRl.creditLimitByResourceKey != NONE THEN $planRl.creditLimitByResourceKey[$resourceKey] ELSE NONE END;
     LET $voucherCreditLimitVal = IF $voucherRl != NONE AND $voucherRl.creditLimitByResourceKey != NONE THEN $voucherRl.creditLimitByResourceKey[$resourceKey] ELSE NONE END;
     LET $mergedCreditLimit = IF $planCreditLimitVal = NONE AND $voucherCreditLimitVal = NONE THEN NONE ELSE ($planCreditLimitVal ?? 0) + ($voucherCreditLimitVal ?? 0) END;

     // ── PERIOD BOUNDS ──────────────────────────────────────────────────
     LET $subPeriodStart = time::format($periodStart, "%Y-%m");
     LET $subPeriodEnd = time::format($periodEnd, "%Y-%m");

     // ── SUBSCRIPTION-LEVEL OPERATION COUNT CHECK ───────────────────────
     // Aggregate across all tenants for this company+system
     LET $currentOpCount = (SELECT math::sum(counts) AS c FROM usage_record
       WHERE tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId)
       AND resourceKey = $resourceKey
       AND period >= $subPeriodStart AND period <= $subPeriodEnd
       GROUP ALL)[0].c ?? 0;
     LET $opsBlocked = IF $mergedOpLimit = NONE THEN false
       ELSE IF $mergedOpLimit <= 0 THEN true
       ELSE IF $currentOpCount >= $mergedOpLimit THEN true
       ELSE false END END;

     // ── SUBSCRIPTION-LEVEL CREDIT LIMIT CHECK (per resourceKey) ─────────
     // Aggregate across all tenants for this company+system
     LET $currentCreditSpent = (SELECT math::sum(value) AS v FROM usage_record
       WHERE tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId)
       AND resourceKey = $resourceKey
       AND period >= $subPeriodStart AND period <= $subPeriodEnd
       GROUP ALL)[0].v ?? 0;
     LET $creditLimitBlocked = IF $mergedCreditLimit = NONE THEN false
       ELSE IF $mergedCreditLimit <= 0 THEN true
       ELSE IF ($currentCreditSpent + $amount) > $mergedCreditLimit THEN true
       ELSE false END END;

     // ── AVAILABLE CREDITS CHECK ────────────────────────────────────────
     // resource_limit.credits is IGNORED for plan/voucher — only
     // subscription.remainingPlanCredits + purchased pool count.
     LET $creditBlocked = $totalAvailable < $amount;

     // remainingOperationCount for backward-compat decrement
     LET $remainingOps = IF $sub.remainingOperationCount IS NOT NONE THEN $sub.remainingOperationCount[$resourceKey] ?? 0 ELSE 0 END;

     // ── ACTOR-LEVEL CHECKS ─────────────────────────────────────────────
     // Per-actor limits checked via usage_record scoped to actor's tenant.
     ${actorLETs}

     // ── RESOLVE NAMES FOR ALERTS ───────────────────────────────────────
     LET $systemNameVal = (SELECT VALUE name FROM system WHERE id = $systemId LIMIT 1)[0];
     LET $companyNameVal = (SELECT VALUE name FROM company WHERE id = $companyId LIMIT 1)[0];

     // ── DECISION AND WRITES ────────────────────────────────────────────
     LET $noActivePlan = $hasActivePlan = false OR $sub = NONE;
     LET $allBlocked = $noActivePlan OR $opsBlocked OR $creditLimitBlocked OR $creditBlocked OR $actorBlocked;

     IF !$allBlocked {
       UPSERT usage_record SET
         tenantIds = ${tenantIdsSet},
         resourceKey = $resourceKey, counts += 1, value += $amount, period = $period
       WHERE ${upsertWhereTenant}
         AND resourceKey = $resourceKey AND period = $period;

       IF $planCredits >= $amount {
         UPDATE $sub.id SET remainingPlanCredits = remainingPlanCredits - $amount
           ${"IF $mergedOpLimit != NONE THEN , remainingOperationCount = object::extend(remainingOperationCount ?? {}, { [$resourceKey]: math::max([0, $remainingOps - 1]) }) END"};
       } ELSE {
         LET $fromPurchased = $amount - $planCredits;
         UPDATE $sub.id SET remainingPlanCredits = 0
           ${"IF $mergedOpLimit != NONE THEN , remainingOperationCount = object::extend(remainingOperationCount ?? {}, { [$resourceKey]: math::max([0, $remainingOps - 1]) }) END"};
         // Deduct from purchased credits pool (resourceKey="credits")
         UPSERT usage_record SET
           tenantIds = ${tenantIdsSet},
           resourceKey = "credits", value -= $fromPurchased, counts += 1, period = $period
         WHERE ${upsertWhereTenant}
           AND resourceKey = "credits" AND period = $period;
       };
     };

     // ── AUTO-RECHARGE TRIGGER ──────────────────────────────────────────
     IF $creditBlocked = true AND $sub != NONE AND $sub.autoRechargeEnabled = true AND $sub.autoRechargeInProgress = false {
       UPDATE $sub.id SET autoRechargeInProgress = true;
     };

     // ── RETURN RESULT ──────────────────────────────────────────────────
     RETURN {
       success: !$noActivePlan AND !$allBlocked,
       source: IF $noActivePlan OR $creditBlocked OR $creditLimitBlocked OR $actorCreditBlocked THEN "insufficient"
         ELSE IF $opsBlocked OR $actorOpsBlocked THEN "operationLimit"
         ELSE IF $planCredits < $amount THEN "purchased"
         ELSE "plan" END,
       resourceKey: $resourceKey,
       actorName: IF $actorBlocked THEN $actorNameVal ELSE "" END,
       systemName: $systemNameVal ?? "",
       companyName: $companyNameVal ?? "",
       remainingPlanCredits: IF !$noActivePlan AND !$allBlocked
         THEN IF $planCredits >= $amount THEN $planCredits - $amount ELSE 0 END
         ELSE $planCredits END,
       remainingPurchasedCredits: IF !$noActivePlan AND !$allBlocked
         THEN IF $planCredits < $amount THEN $purchasedCredits - ($amount - $planCredits) ELSE $purchasedCredits END
         ELSE $purchasedCredits END,
       autoRechargeTriggered: IF $creditBlocked AND $sub != NONE AND $sub.autoRechargeEnabled = true AND $sub.autoRechargeInProgress = false THEN true ELSE false END,
       subscriptionId: IF $sub != NONE THEN $sub.id ELSE NONE END
     };`,
    {
      ...companySystemBindings(tenant),
      ...(tenant.id ? { tenantId: rid(tenant.id) } : {}),
      resourceKey,
      amount,
      period: new Date().toISOString().slice(0, 7),
      ...(tenant.actorId
        ? {
          actorRid: rid(tenant.actorId),
          actorStr: tenant.actorId,
        }
        : {}),
    },
  );

  const row = result[0]?.[0] as Record<string, unknown> | undefined;
  return {
    success: row?.success === true,
    source: (row?.source as
      | "plan"
      | "purchased"
      | "insufficient"
      | "operationLimit") ?? "insufficient",
    resourceKey: String(row?.resourceKey ?? resourceKey),
    actorName: String(row?.actorName ?? ""),
    systemName: String(row?.systemName ?? ""),
    companyName: String(row?.companyName ?? ""),
    remainingPlanCredits: row?.remainingPlanCredits as number | undefined,
    remainingPurchasedCredits: row?.remainingPurchasedCredits as
      | number
      | undefined,
    autoRechargeTriggered: row?.autoRechargeTriggered as boolean | undefined,
    subscriptionId: row?.subscriptionId
      ? String(row.subscriptionId)
      : undefined,
  };
}
