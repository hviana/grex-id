import { getDb, rid } from "../connection.ts";
import type { ConnectedService } from "@/src/contracts/connected-service";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("connected-services");

export async function listConnectedServices(params: {
  companyId: string;
  systemId: string;
  userId?: string;
  search?: string;
}): Promise<ConnectedService[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  const conditions: string[] = [];

  if (params.companyId && params.companyId !== "0") {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(params.companyId);
  }
  if (params.systemId && params.systemId !== "0") {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(params.systemId);
  }
  if (params.userId) {
    conditions.push("userId = $userId");
    bindings.userId = rid(params.userId);
  }
  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }

  let query =
    "SELECT *, userId.profile.name AS userName FROM connected_service";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50 FETCH userId.profile";

  const result = await db.query<[ConnectedService[]]>(query, bindings);
  return result[0] ?? [];
}

export async function createConnectedService(data: {
  userId: string;
  name: string;
  companyId: string;
  systemId: string;
  serviceData?: Record<string, unknown>;
}): Promise<ConnectedService | undefined> {
  const db = await getDb();
  const result = await db.query<[ConnectedService[]]>(
    `CREATE connected_service SET
      userId = $userId,
      name = $name,
      companyId = $companyId,
      systemId = $systemId,
      data = $data`,
    {
      userId: rid(data.userId),
      name: data.name,
      companyId: rid(data.companyId),
      systemId: rid(data.systemId),
      data: data.serviceData ?? undefined,
    },
  );
  return result[0]?.[0];
}

export async function deleteConnectedService(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
