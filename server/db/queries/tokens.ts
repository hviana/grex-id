import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant.ts";

export async function listTokens(
  userId: string,
  companyId?: string,
): Promise<Omit<ApiToken, "tokenHash">[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { userId };
  let query =
    `SELECT id, userId, tenant, companyId, systemId, name, description,
            permissions, monthlySpendLimit, neverExpires, expiresAt,
            frontendUse, frontendDomains, jti, revokedAt, createdAt
     FROM api_token WHERE userId = $userId AND revokedAt IS NONE`;

  if (companyId) {
    query += " AND companyId = $companyId";
    bindings.companyId = companyId;
  }

  query += " ORDER BY createdAt DESC";

  const result = await db.query<[Omit<ApiToken, "tokenHash">[]]>(
    query,
    bindings,
  );
  return result[0] ?? [];
}

export async function findTokenByHash(
  tokenHash: string,
): Promise<ApiToken | null> {
  const db = await getDb();
  const result = await db.query<[ApiToken[]]>(
    "SELECT * FROM api_token WHERE tokenHash = $tokenHash LIMIT 1",
    { tokenHash },
  );
  return result[0]?.[0] ?? null;
}

export async function findTokenByJti(
  jti: string,
): Promise<ApiToken | null> {
  const db = await getDb();
  const result = await db.query<[ApiToken[]]>(
    "SELECT * FROM api_token WHERE jti = $jti LIMIT 1",
    { jti },
  );
  return result[0]?.[0] ?? null;
}

export async function createToken(data: {
  userId: string;
  companyId: string;
  systemId: string;
  tenant: Tenant;
  name: string;
  description?: string;
  tokenHash: string;
  jti: string;
  permissions: string[];
  monthlySpendLimit?: number;
  neverExpires: boolean;
  expiresAt?: string;
  frontendUse: boolean;
  frontendDomains: string[];
}): Promise<string> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      description = $description,
      tokenHash = $tokenHash,
      jti = $jti,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      neverExpires = $neverExpires,
      expiresAt = $expiresAt,
      frontendUse = $frontendUse,
      frontendDomains = $frontendDomains`,
    {
      userId: rid(data.userId),
      companyId: rid(data.companyId),
      systemId: rid(data.systemId),
      tenant: data.tenant,
      name: data.name,
      description: data.description ?? undefined,
      tokenHash: data.tokenHash,
      jti: data.jti,
      permissions: data.permissions ?? [],
      monthlySpendLimit: data.monthlySpendLimit ?? undefined,
      neverExpires: data.neverExpires,
      expiresAt: data.expiresAt
        ? new Date(data.expiresAt + "T23:59:59.999Z")
        : undefined,
      frontendUse: data.frontendUse,
      frontendDomains: data.frontendDomains ?? [],
    },
  );
  return String(result[0]?.[0]?.id ?? "");
}

/**
 * Soft-delete: sets revokedAt instead of hard-deleting.
 * The token-cleanup job hard-deletes after 90 days.
 */
export async function revokeToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE`,
    { id: rid(id) },
  );
}

/**
 * Hard delete (used by cleanup job after 90 days).
 */
export async function deleteToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
