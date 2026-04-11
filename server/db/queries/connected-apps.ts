import { getDb, rid } from "../connection.ts";
import type { ConnectedApp } from "@/src/contracts/connected-app";

export async function listConnectedApps(
  companyId: string,
  systemId?: string,
): Promise<ConnectedApp[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { companyId };
  let query = "SELECT * FROM connected_app WHERE companyId = $companyId";

  if (systemId) {
    query += " AND systemId = $systemId";
    bindings.systemId = systemId;
  }

  query += " ORDER BY createdAt DESC";

  const result = await db.query<[ConnectedApp[]]>(query, bindings);
  return result[0] ?? [];
}

export async function createConnectedApp(data: {
  name: string;
  companyId: string;
  systemId: string;
  permissions: string[];
  monthlySpendLimit?: number;
}): Promise<ConnectedApp> {
  const db = await getDb();
  const result = await db.query<[ConnectedApp[]]>(
    `CREATE connected_app SET
      name = $name,
      companyId = $companyId,
      systemId = $systemId,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit`,
    {
      ...data,
      monthlySpendLimit: data.monthlySpendLimit ?? undefined,
    },
  );
  return result[0][0];
}

export async function deleteConnectedApp(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
