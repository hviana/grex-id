import { getDb, rid } from "../connection.ts";
import type { Company } from "@/src/contracts/company";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

export async function listCompanies(
  params: CursorParams & { search?: string; userId?: string },
): Promise<PaginatedResult<Company>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };

  let query = "SELECT * FROM company";
  const conditions: string[] = [];

  if (params.userId) {
    conditions.push(
      "id IN (SELECT VALUE companyId FROM company_user WHERE userId = $userId)",
    );
    bindings.userId = rid(params.userId);
  }
  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit FETCH billingAddress";

  const result = await db.query<[Company[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function createCompany(data: {
  name: string;
  document: string;
  documentType: string;
  billingAddress?: Record<string, string>;
  ownerId: string;
}): Promise<Company> {
  const db = await getDb();

  const hasAddress = data.billingAddress &&
    Object.keys(data.billingAddress).length > 0;
  const addr = data.billingAddress;

  if (hasAddress) {
    const result = await db.query<[unknown, unknown, unknown, Company[]]>(
      `LET $addr = CREATE address SET
        street = $street,
        number = $number,
        complement = $complement,
        neighborhood = $neighborhood,
        city = $city,
        state = $state,
        country = $country,
        postalCode = $postalCode;
      LET $comp = CREATE company SET
        name = $name,
        document = $document,
        documentType = $documentType,
        billingAddress = $addr[0].id,
        ownerId = $ownerId;
      CREATE company_user SET companyId = $comp[0].id, userId = $ownerId;
      SELECT * FROM $comp[0].id FETCH billingAddress;`,
      {
        street: addr!.street ?? "",
        number: addr!.number ?? "",
        complement: addr!.complement || undefined,
        neighborhood: addr!.neighborhood || undefined,
        city: addr!.city ?? "",
        state: addr!.state ?? "",
        country: addr!.country ?? "",
        postalCode: addr!.postalCode ?? "",
        name: data.name,
        document: data.document,
        documentType: data.documentType,
        ownerId: rid(data.ownerId),
      },
    );
    return result[3][0];
  }

  const result = await db.query<[unknown, unknown, Company[]]>(
    `LET $comp = CREATE company SET
      name = $name,
      document = $document,
      documentType = $documentType,
      ownerId = $ownerId;
    CREATE company_user SET companyId = $comp[0].id, userId = $ownerId;
    SELECT * FROM $comp[0].id FETCH billingAddress;`,
    {
      name: data.name,
      document: data.document,
      documentType: data.documentType,
      ownerId: rid(data.ownerId),
    },
  );
  return result[2][0];
}
