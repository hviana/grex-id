import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("file-access");

export interface FileAccessSection {
  isolateSystem: boolean;
  isolateCompany: boolean;
  isolateUser: boolean;
  permissions: string[];
  maxFileSizeMB?: number;
  allowedExtensions?: string[];
}

export interface FileAccessRule {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessSection & {
    maxFileSizeMB?: number;
    allowedExtensions?: string[];
  };
  createdAt: string;
}

export async function listFileAccessRules(params: {
  search?: string;
  cursor?: string;
  limit: number;
}): Promise<{ data: Record<string, unknown>[]; nextCursor: string | null }> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { limit: params.limit + 1 };
  const conditions: string[] = [];

  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }

  if (params.cursor) {
    conditions.push("id < $cursor");
    bindings.cursor = params.cursor;
  }

  let query = "SELECT * FROM file_access";
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > params.limit;
  const data = hasMore ? items.slice(0, params.limit) : items;

  return {
    data,
    nextCursor: hasMore && data.length > 0
      ? data[data.length - 1]?.id?.toString() ?? null
      : null,
  };
}

export async function createFileAccessRule(data: {
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessSection & {
    maxFileSizeMB?: number;
    allowedExtensions?: string[];
  };
}): Promise<Record<string, unknown>> {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    `CREATE file_access SET
      name = $name,
      categoryPattern = $categoryPattern,
      download = $download,
      upload = $upload`,
    {
      name: data.name,
      categoryPattern: data.categoryPattern,
      download: data.download,
      upload: data.upload,
    },
  );
  return result[0][0];
}

export async function updateFileAccessRule(
  id: string,
  sets: string[],
  bindings: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  bindings.id = rid(id);

  const result = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );
  return result[0]?.[0] ?? null;
}

export async function deleteFileAccessRule(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}

/**
 * Loads all file access rules from the database for cache hydration.
 * Returns raw records ordered by creation date.
 */
export async function fetchAllFileAccessRules(): Promise<
  Record<string, unknown>[]
> {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    "SELECT * FROM file_access ORDER BY createdAt ASC",
  );
  return result[0] ?? [];
}
