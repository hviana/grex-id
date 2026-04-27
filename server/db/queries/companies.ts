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
  systemId: string;
}): Promise<Company> {
  const db = await getDb();

  const hasAddress = data.billingAddress &&
    Object.keys(data.billingAddress).length > 0;
  const addr = data.billingAddress;

  if (hasAddress) {
    const result = await db.query<
      [unknown, unknown, unknown, unknown, unknown, Company[]]
    >(
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
        billingAddressId = $addr[0].id;
      LET $companyTenant = CREATE tenant SET
        actorId = NONE,
        companyId = $comp[0].id,
        systemId = NONE;
      LET $ownerTenant = CREATE tenant SET
        actorId = $ownerId,
        companyId = $comp[0].id,
        systemId = NONE,
        isOwner = true;
      LET $userAccessTenant = CREATE tenant SET
        actorId = $ownerId,
        companyId = $comp[0].id,
        systemId = $systemId;
      SELECT * FROM $comp[0].id FETCH billingAddressId;`,
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
        systemId: rid(data.systemId),
      },
    );
    return result[5][0];
  }

  const result = await db.query<
    [unknown, unknown, unknown, unknown, Company[]]
  >(
    `LET $comp = CREATE company SET
      name = $name,
      document = $document,
      documentType = $documentType;
    LET $companyTenant = CREATE tenant SET
      actorId = NONE,
      companyId = $comp[0].id,
      systemId = NONE;
    LET $ownerTenant = CREATE tenant SET
      actorId = $ownerId,
      companyId = $comp[0].id,
      systemId = NONE,
      isOwner = true;
    LET $userAccessTenant = CREATE tenant SET
      actorId = $ownerId,
      companyId = $comp[0].id,
      systemId = $systemId;
    SELECT * FROM $comp[0].id FETCH billingAddressId;`,
    {
      name: data.name,
      document: data.document,
      documentType: data.documentType,
      ownerId: rid(data.ownerId),
      systemId: rid(data.systemId),
    },
  );
  return result[4][0];
}
