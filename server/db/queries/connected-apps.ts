import { getDb, rid } from "../connection.ts";
import type { ConnectedApp } from "@/src/contracts/connected-app";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("connected-apps");

/**
 * Create a connected_app AND its backing api_token in one batched query
 * (§7.2). Returns both the app row and the token row so the route handler
 * can issue a JWT (§8.1) whose actorId is the api_token id.
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
 * Revoke the linked api_token AND delete the connected_app in a single
 * batched query (§7.2). Returns the linked apiTokenId, companyId, and
 * systemId so the caller can evict the actor from the validity cache
 * (§8.11 / §8.11).
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
