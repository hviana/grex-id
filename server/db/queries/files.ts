import { getDb, rid } from "../connection.ts";
import type { FileMetadata } from "@/src/contracts/file";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("files");

/**
 * Files use `companyId`/`systemSlug`/`userId` in path segments (via
 * @hviana/surreal-fs). Any DB-level queries scope by `tenantIds`.
 */

export async function listFiles(
  params: CursorParams & {
    tenantId?: string;
    userId?: string;
    companyId?: string;
    systemSlug?: string;
  },
): Promise<PaginatedResult<FileMetadata>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (params.tenantId) {
    conditions.push("tenantIds CONTAINS $tenantId");
    bindings.tenantId = rid(params.tenantId);
  }
  if (params.userId) {
    conditions.push("userId = $userId");
    bindings.userId = params.userId;
  }
  if (params.companyId) {
    conditions.push("companyId = $companyId");
    bindings.companyId = params.companyId;
  }
  if (params.systemSlug) {
    conditions.push("systemSlug = $systemSlug");
    bindings.systemSlug = params.systemSlug;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  let query = "SELECT * FROM file_metadata";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[FileMetadata[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function findFileByUri(uri: string): Promise<FileMetadata | null> {
  const db = await getDb();
  const result = await db.query<[FileMetadata[]]>(
    "SELECT * FROM file_metadata WHERE uri = $uri LIMIT 1",
    { uri },
  );
  return result[0]?.[0] ?? null;
}

export async function createFileMetadata(data: {
  tenantId: string;
  systemSlug: string;
  companyId: string;
  userId: string;
  fileName: string;
  fileUuid: string;
  uri: string;
  sizeBytes: number;
  mimeType: string;
  description?: string;
}): Promise<FileMetadata> {
  const db = await getDb();
  const result = await db.query<[FileMetadata[]]>(
    `CREATE file_metadata SET
      tenantIds = [$tenantId],
      systemSlug = $systemSlug,
      companyId = $companyId,
      userId = $userId,
      fileName = $fileName,
      fileUuid = $fileUuid,
      uri = $uri,
      sizeBytes = $sizeBytes,
      mimeType = $mimeType,
      description = $description`,
    {
      ...data,
      tenantId: rid(data.tenantId),
      description: data.description ?? undefined,
    },
  );
  return result[0][0];
}

export async function getStorageUsage(
  tenantId: string,
): Promise<number> {
  const db = await getDb();
  const result = await db.query<[{ total: number }[]]>(
    "SELECT math::sum(sizeBytes) AS total FROM file_metadata WHERE tenantIds CONTAINS $tenantId GROUP ALL",
    { tenantId: rid(tenantId) },
  );
  return result[0]?.[0]?.total ?? 0;
}

export async function deleteFileMetadata(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
