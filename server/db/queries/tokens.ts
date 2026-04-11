import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/token";

export async function listTokens(
  userId: string,
  companyId?: string,
): Promise<Omit<ApiToken, "tokenHash">[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { userId };
  let query =
    "SELECT id, userId, companyId, systemId, name, description, permissions, monthlySpendLimit, expiresAt, createdAt FROM api_token WHERE userId = $userId";

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

export async function createToken(data: {
  userId: string;
  companyId: string;
  systemId: string;
  name: string;
  description?: string;
  tokenHash: string;
  permissions: string[];
  monthlySpendLimit?: number;
  expiresAt?: string;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      name = $name,
      description = $description,
      tokenHash = $tokenHash,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      expiresAt = $expiresAt`,
    {
      ...data,
      description: data.description ?? undefined,
      monthlySpendLimit: data.monthlySpendLimit ?? undefined,
      expiresAt: data.expiresAt
        ? new Date(data.expiresAt + "T23:59:59.999Z")
        : undefined,
    },
  );
}

export async function deleteToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
