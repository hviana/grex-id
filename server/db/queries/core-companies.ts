import { rid } from "../connection.ts";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { paginatedQuery } from "./pagination.ts";
import { getDb } from "../connection.ts";

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
}

export async function listCoreCompanies(
  params: CursorParams & {
    search?: string;
    startDate?: string;
    endDate?: string;
    systemIds?: string[];
    planIds?: string[];
  },
): Promise<PaginatedResult<CoreCompany>> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }

  // Filter to companies that have a company_system matching the given systems
  if (params.systemIds?.length) {
    conditions.push(
      "id IN (SELECT VALUE companyId FROM company_system WHERE systemId IN $systemIds)",
    );
    bindings.systemIds = params.systemIds.map((id) => rid(id));
  }

  // Filter to companies that have a subscription matching the given plans
  if (params.planIds?.length) {
    conditions.push(
      "id IN (SELECT VALUE companyId FROM subscription WHERE planId IN $planIds)",
    );
    bindings.planIds = params.planIds.map((id) => rid(id));
  }

  const paginated = await paginatedQuery<{
    id: string;
    name: string;
    document: string;
    createdAt: string;
  }>({
    table: "company",
    conditions,
    bindings,
    params,
  });

  if (paginated.data.length === 0) {
    return { data: [], nextCursor: null, prevCursor: null };
  }

  const companyIds = paginated.data.map((c) => rid(c.id));

  // Single batched query: company_systems + subscriptions for all companies (§7.2)
  const db = await getDb();
  const [companySystems, subs] = await db.query<
    [
      {
        companyId: string;
        systemId: string;
        systemName: string;
        systemSlug: string;
      }[],
      {
        id: string;
        companyId: string;
        systemId: string;
        status: string;
        planName: string;
        planPrice: number;
      }[],
    ]
  >(
    `SELECT
      companyId,
      systemId,
      (SELECT VALUE name FROM system WHERE id = $value.systemId LIMIT 1)[0] AS systemName,
      (SELECT VALUE slug FROM system WHERE id = $value.systemId LIMIT 1)[0] AS systemSlug
    FROM company_system
    WHERE companyId IN $companyIds
    ORDER BY systemId;
    SELECT
      id,
      companyId,
      systemId,
      status,
      (SELECT VALUE name FROM plan WHERE id = $value.planId LIMIT 1)[0] AS planName,
      (SELECT VALUE price FROM plan WHERE id = $value.planId LIMIT 1)[0] AS planPrice
    FROM subscription
    WHERE companyId IN $companyIds;`,
    { companyIds },
  );

  // Build lookup maps
  const subMap = new Map<string, (typeof subs)[0]>();
  for (const sub of subs ?? []) {
    subMap.set(`${sub.companyId}|${sub.systemId}`, sub);
  }

  const csMap = new Map<string, typeof companySystems>();
  for (const cs of companySystems ?? []) {
    const list = csMap.get(String(cs.companyId)) ?? [];
    list.push(cs);
    csMap.set(String(cs.companyId), list);
  }

  const companies: CoreCompany[] = paginated.data.map((c) => {
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
    nextCursor: paginated.nextCursor,
    prevCursor: paginated.prevCursor,
  };
}

export async function getRevenueChart(params: {
  startDate: string;
  endDate: string;
  planIds?: string[];
}): Promise<RevenueChart> {
  const db = await getDb();
  const planFilter = params.planIds?.length ? `AND planId IN $planIds` : "";
  const bindings: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };
  if (params.planIds?.length) {
    bindings.planIds = params.planIds.map((id) => rid(id));
  }

  const result = await db.query<
    [{ canceled: number; paid: number; projected: number }[]]
  >(
    `SELECT VALUE {
      canceled: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $value.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE status = "cancelled"
          AND updatedAt >= type::datetime($startDate)
          AND updatedAt <= type::datetime($endDate)
          ${planFilter}
      ))[0] ?? 0,
      paid: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $value.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE status = "active"
          AND currentPeriodStart >= type::datetime($startDate)
          AND currentPeriodStart <= type::datetime($endDate)
          ${planFilter}
      ))[0] ?? 0,
      projected: (SELECT VALUE math::sum(planPrice) FROM (
        SELECT (SELECT VALUE price FROM plan WHERE id = $value.planId LIMIT 1)[0] AS planPrice
        FROM subscription
        WHERE status = "active"
          AND currentPeriodEnd >= type::datetime($startDate)
          AND currentPeriodEnd <= type::datetime($endDate)
          ${planFilter}
      ))[0] ?? 0
    } FROM ONLY [];`,
    bindings,
  );

  return result[0]?.[0] ?? { canceled: 0, paid: 0, projected: 0 };
}
