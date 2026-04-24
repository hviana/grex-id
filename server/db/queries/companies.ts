import { getDb, rid } from "../connection.ts";
import type { Company } from "@/src/contracts/company";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("companies");

export async function createCompany(data: {
  name: string;
  document: string;
  documentType: string;
  billingAddress?: Record<string, string>;
  ownerId: string;
}): Promise<Company> {
  const { getDb } = await import("../connection.ts");
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

/**
 * Get all systems subscribed by a company in a single batched query (§7.2).
 * Returns the system rows resolved from the company_system associations.
 */
export async function getCompanySystems(
  companyId: string,
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    `SELECT * FROM system WHERE id IN (
       SELECT VALUE systemId FROM company_system WHERE companyId = $companyId
     )`,
    { companyId: rid(companyId) },
  );
  return result[0] ?? [];
}
