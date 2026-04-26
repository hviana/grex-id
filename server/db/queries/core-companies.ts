import { getDb, rid } from "../connection.ts";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("core-companies");

export interface CoreCompanySystem {
  systemId: string;
  systemName: string;
  systemSlug: string;
  subscriptionId: string | null;
  planName: string | null;
  planPrice: number;
  status: "active" | "past_due" | "cancelled" | null;
}

export interface CoreCompany {
  id: string;
  name: string;
  document: string;
  createdAt: string;
  systems: CoreCompanySystem[];
}

export interface RevenueChart {
  canceled: number;
  paid: number;
  projected: number;
  errors: number;
}

/**
 * Core admin company listing. Uses the `tenant` table to resolve
 * company-system associations (actorId=NONE rows) and owner
 * (isOwner=true rows) instead of `company_system`/`company_user`.
 */
export async function listCoreCompanies(
  params: CursorParams & {
    search?: string;
    systemIds?: string[];
    planIds?: string[];
    statuses?: string[];
  },
): Promise<PaginatedResult<CoreCompany>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {
    limitPlusOne: limit + 1,
  };

  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }

  if (params.systemIds?.length) {
    conditions.push(
      "id IN (SELECT VALUE companyId FROM tenant WHERE actorId = NONE AND systemId IN $systemIds AND systemId != NONE)",
    );
    bindings.systemIds = params.systemIds.map((id) => rid(id));
  }

  if (params.statuses?.length) {
    bindings.statuses = params.statuses;
    const planClause = params.planIds?.length ? " AND planId IN $planIds" : "";
    if (params.planIds?.length) {
      bindings.planIds = params.planIds.map((id) => rid(id));
    }
    conditions.push(
      `id IN (SELECT VALUE companyId FROM tenant WHERE actorId = NONE AND systemId != NONE AND id IN (SELECT VALUE tenantIds[0] FROM subscription WHERE status IN $statuses${planClause}))`,
    );
  } else if (params.planIds?.length) {
    conditions.push(
      "id IN (SELECT VALUE companyId FROM tenant WHERE actorId = NONE AND systemId != NONE AND id IN (SELECT VALUE tenantIds[0] FROM subscription WHERE planId IN $planIds))",
    );
    bindings.planIds = params.planIds.map((id) => rid(id));
  }

  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // Single batched query: pagination + enrichment (§2.4)
  const result = await db.query<
    [
      unknown,
      unknown,
      {
        companyId: string;
        systemId: string;
        systemName: string;
        systemSlug: string;
      }[],
      {
        id: string;
        tenantId: string;
        companyId: string;
        systemId: string;
        status: string;
        planName: string;
        planPrice: number;
      }[],
    ]
  >(
    `LET $paginated = (SELECT id, name, document, createdAt FROM company ${where} ORDER BY createdAt DESC LIMIT $limitPlusOne);
     LET $companyIds = $paginated[*].id;
     SELECT
       companyId,
       systemId,
       (SELECT VALUE name FROM system WHERE id = $value.systemId LIMIT 1)[0] AS systemName,
       (SELECT VALUE slug FROM system WHERE id = $value.systemId LIMIT 1)[0] AS systemSlug
     FROM tenant
     WHERE companyId IN $companyIds AND actorId = NONE AND systemId != NONE
     ORDER BY systemId;
     SELECT
       id,
       tenantIds[0] AS tenantId,
       companyId,
       systemId,
       status,
       (SELECT VALUE name FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planName,
       (SELECT VALUE price FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planPrice
     FROM subscription
     WHERE tenantIds[0] IN (SELECT VALUE id FROM tenant WHERE companyId IN $companyIds AND actorId = NONE AND systemId != NONE);`,
    bindings,
  );

  const companiesRaw = result[0] as
    | { id: string; name: string; document: string; createdAt: string }[]
    | undefined;
  const companySystems = result[2] ?? [];
  const subs = result[3] ?? [];

  if (!companiesRaw || companiesRaw.length === 0) {
    return { data: [], nextCursor: null, prevCursor: null };
  }

  const hasMore = companiesRaw.length > limit;
  const page = hasMore ? companiesRaw.slice(0, limit) : companiesRaw;
  const lastItem = page[page.length - 1] as
    | Record<string, unknown>
    | undefined;

  // Build lookup maps
  const subMap = new Map<string, (typeof subs)[0]>();
  for (const sub of subs) {
    subMap.set(`${sub.companyId}|${sub.systemId}`, sub);
  }

  const csMap = new Map<string, typeof companySystems>();
  for (const cs of companySystems) {
    const list = csMap.get(String(cs.companyId)) ?? [];
    list.push(cs);
    csMap.set(String(cs.companyId), list);
  }

  const companies: CoreCompany[] = page.map((c) => {
    const systems = (csMap.get(String(c.id)) ?? []).map((cs) => {
      const sub = subMap.get(`${cs.companyId}|${cs.systemId}`);
      return {
        systemId: String(cs.systemId),
        systemName: cs.systemName ?? "",
        systemSlug: cs.systemSlug ?? "",
        subscriptionId: sub ? String(sub.id) : null,
        planName: sub?.planName ?? null,
        planPrice: sub?.planPrice ?? 0,
        status: (sub?.status as CoreCompanySystem["status"]) ?? null,
      };
    });

    return {
      id: String(c.id),
      name: c.name,
      document: c.document,
      createdAt: c.createdAt,
      systems,
    };
  });

  return {
    data: companies,
    nextCursor: hasMore ? String(lastItem?.id ?? "") : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function getRevenueChart(params: {
  startDate: string;
  endDate: string;
  systemIds?: string[];
  planIds?: string[];
  statuses?: string[];
}): Promise<RevenueChart> {
  const db = await getDb();
  const extraFilters: string[] = [];
  const bindings: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };
  if (params.planIds?.length) {
    extraFilters.push("planId IN $planIds");
    bindings.planIds = params.planIds.map((id) => rid(id));
  }
  if (params.systemIds?.length) {
    extraFilters.push(
      "tenantIds[0] IN (SELECT VALUE id FROM tenant WHERE actorId = NONE AND systemId IN $systemIds AND systemId != NONE)",
    );
    bindings.systemIds = params.systemIds.map((id) => rid(id));
  }
  const extra = extraFilters.length ? `AND ${extraFilters.join(" AND ")}` : "";

  // Status filter
  const statusFilterActive = params.statuses?.length;
  if (statusFilterActive) {
    bindings.statuses = params.statuses;
  }

  const canceledCond = statusFilterActive
    ? `status IN $statuses AND status = "cancelled"`
    : `status = "cancelled"`;
  const paidCond = statusFilterActive
    ? `status IN $statuses AND status = "active"`
    : `status = "active"`;
  const projectedCond = paidCond;
  const errorsCond = statusFilterActive
    ? `status IN $statuses AND status = "past_due"`
    : `status = "past_due"`;

  const result = await db.query<
    [{ canceled: number; paid: number; projected: number; errors: number }]
  >(
    `RETURN {
      canceled: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE ${canceledCond}
          AND updatedAt >= type::datetime($startDate)
          AND updatedAt <= type::datetime($endDate)
          ${extra}
      ))[0] ?? 0,
      paid: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE ${paidCond}
          AND currentPeriodStart >= type::datetime($startDate)
          AND currentPeriodStart <= type::datetime($endDate)
          ${extra}
      ))[0] ?? 0,
      projected: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE ${projectedCond}
          AND currentPeriodEnd >= type::datetime($startDate)
          AND currentPeriodEnd <= type::datetime($endDate)
          ${extra}
      ))[0] ?? 0,
      errors: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $parent.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE ${errorsCond}
          AND updatedAt >= type::datetime($startDate)
          AND updatedAt <= type::datetime($endDate)
          ${extra}
      ))[0] ?? 0
    };`,
    bindings,
  );

  return result[0] ?? { canceled: 0, paid: 0, projected: 0, errors: 0 };
}
