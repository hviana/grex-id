import { getDb, rid } from "../connection.ts";
import type { ConnectedApp } from "@/src/contracts/connected-app";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("connected-apps");

/**
 * List connected apps, optionally filtered by companyId and/or systemId.
 * Used by the GET handler and the ConnectedAppsPage (§21.3).
 */
export async function listConnectedApps(params: {
  companyId?: string;
  systemId?: string;
}): Promise<ConnectedApp[]> {
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

  let query = "SELECT * FROM connected_app";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[ConnectedApp[]]>(query, bindings);
  return result[0] ?? [];
}

/**
 * Create a connected_app AND its backing api_token in one batched query
 * (§7.2). Returns both the app row and the token row so the route handler
 * can issue a JWT (§19.10) whose actorId is the api_token id.
 */
export async function createConnectedAppWithToken(data: {
  userId: string;
  name: string;
  companyId: string;
  systemId: string;
  tenant: Tenant;
  permissions: string[];
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>;
  description?: string;
}): Promise<{ app: ConnectedApp; token: ApiToken }> {
  const db = await getDb();
  const result = await db.query<[unknown, unknown, ConnectedApp[], ApiToken[]]>(
    `LET $tkn = CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      description = $description,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      maxOperationCount = $maxOperationCount,
      neverExpires = true,
      frontendUse = false,
      frontendDomains = [];
    LET $app = CREATE connected_app SET
      name = $name,
      companyId = $companyId,
      systemId = $systemId,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      maxOperationCount = $maxOperationCount,
      apiTokenId = $tkn[0].id;
    SELECT * FROM $app[0].id;
    SELECT * FROM $tkn[0].id;`,
    {
      userId: rid(data.userId),
      name: data.name,
      description: data.description ?? "",
      companyId: rid(data.companyId),
      systemId: rid(data.systemId),
      tenant: data.tenant,
      permissions: data.permissions ?? [],
      monthlySpendLimit: data.monthlySpendLimit ?? undefined,
      maxOperationCount: data.maxOperationCount ?? undefined,
    },
  );

  const app = result[2]?.[0];
  const token = result[3]?.[0];
  return { app, token };
}

/**
 * Update a connected_app's mutable fields. Only non-undefined fields are
 * SET; if nothing to update, returns null.
 */
export async function updateConnectedApp(data: {
  id: string;
  name?: string;
  permissions?: string[];
  monthlySpendLimit?: number;
}): Promise<ConnectedApp | null> {
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(data.id) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.permissions !== undefined) {
    sets.push("permissions = $permissions");
    bindings.permissions = data.permissions;
  }
  if (data.monthlySpendLimit !== undefined) {
    sets.push("monthlySpendLimit = $monthlySpendLimit");
    bindings.monthlySpendLimit = data.monthlySpendLimit || undefined;
  }

  if (sets.length === 0) return null;

  const db = await getDb();
  const result = await db.query<[ConnectedApp[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );

  return result[0]?.[0] ?? null;
}

/**
 * Revoke the linked api_token AND delete the connected_app in a single
 * batched query (§7.2). Returns the linked apiTokenId, companyId, and
 * systemId so the caller can evict the actor from the validity cache
 * (§12.8 / §19.12).
 */
export async function revokeConnectedApp(id: string): Promise<
  {
    apiTokenId: string;
    companyId: string;
    systemId: string;
  } | null
> {
  const db = await getDb();
  const result = await db.query<
    [
      unknown,
      unknown,
      unknown,
      { apiTokenId: string; companyId: string; systemId: string }[],
    ]
  >(
    `LET $app = (SELECT apiTokenId, companyId, systemId FROM $id LIMIT 1);
     IF $app[0].apiTokenId != NONE {
       UPDATE $app[0].apiTokenId SET revokedAt = time::now() WHERE revokedAt IS NONE;
     };
     DELETE $id;
     RETURN $app;`,
    { id: rid(id) },
  );

  const row = result[3]?.[0];
  if (!row?.apiTokenId || !row?.companyId || !row?.systemId) return null;
  return {
    apiTokenId: String(row.apiTokenId),
    companyId: String(row.companyId),
    systemId: String(row.systemId),
  };
}
