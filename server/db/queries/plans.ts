import { getDb, rid } from "../connection.ts";
import type { Plan } from "@/src/contracts/plan";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

export async function listPlans(
  params: CursorParams & {
    search?: string;
    systemId?: string;
    activeOnly?: boolean;
  },
): Promise<PaginatedResult<Plan>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (params.systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = params.systemId;
  }
  if (params.activeOnly) {
    conditions.push("isActive = true");
  }
  if (params.search) {
    conditions.push("name CONTAINS $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  let query = "SELECT * FROM plan";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Plan[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function createPlan(data: {
  name: string;
  description: string;
  systemId: string;
  price: number;
  currency?: string;
  recurrenceDays: number;
  benefits: string[];
  permissions: string[];
  entityLimits?: Record<string, number>;
  apiRateLimit?: number;
  storageLimitBytes?: number;
}): Promise<Plan> {
  const db = await getDb();
  const hasEntityLimits = data.entityLimits &&
    Object.keys(data.entityLimits).length > 0;
  const result = await db.query<[Plan[]]>(
    `CREATE plan SET
      name = $name,
      description = $description,
      systemId = $systemId,
      price = $price,
      currency = $currency,
      recurrenceDays = $recurrenceDays,
      benefits = $benefits,
      permissions = $permissions,
      ${hasEntityLimits ? "entityLimits = $entityLimits," : ""}
      apiRateLimit = $apiRateLimit,
      storageLimitBytes = $storageLimitBytes,
      isActive = true`,
    {
      ...data,
      currency: data.currency ?? "USD",
      entityLimits: hasEntityLimits ? data.entityLimits : undefined,
      apiRateLimit: data.apiRateLimit ?? 1000,
      storageLimitBytes: data.storageLimitBytes ?? 1073741824,
    },
  );
  return result[0][0];
}

export async function updatePlan(
  id: string,
  data: Partial<Plan>,
): Promise<Plan> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  const fields = [
    "name",
    "description",
    "price",
    "currency",
    "recurrenceDays",
    "benefits",
    "permissions",
    "entityLimits",
    "apiRateLimit",
    "storageLimitBytes",
    "isActive",
  ] as const;
  for (const field of fields) {
    if (data[field] !== undefined) {
      const value = data[field];
      if (
        field === "entityLimits" &&
        (value === null ||
          (typeof value === "object" &&
            Object.keys(value as object).length === 0))
      ) {
        sets.push(`${field} = NONE`);
      } else {
        sets.push(`${field} = $${field}`);
        bindings[field] = value;
      }
    }
  }
  sets.push("updatedAt = time::now()");

  const result = await db.query<[Plan[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );
  return result[0][0];
}

export async function deletePlan(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
