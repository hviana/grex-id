import { getDb } from "../connection.ts";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

interface PaginatedQueryOptions {
  table: string;
  cursorField?: string;
  select?: string;
  fetch?: string;
  conditions?: string[];
  bindings?: Record<string, unknown>;
  orderBy?: string;
  params: CursorParams;
}

export async function paginatedQuery<T>(
  options: PaginatedQueryOptions,
): Promise<PaginatedResult<T>> {
  const db = await getDb();
  const limit = clampPageLimit(options.params.limit);
  const field = options.cursorField ?? "id";
  const select = options.select ?? "*";
  const orderBy = options.orderBy ?? "createdAt DESC";
  const bindings: Record<string, unknown> = {
    ...(options.bindings ?? {}),
    limit: limit + 1,
  };

  const conditions = [...(options.conditions ?? [])];

  if (options.params.cursor) {
    conditions.push(
      options.params.direction === "prev"
        ? `${field} < $cursor`
        : `${field} > $cursor`,
    );
    bindings.cursor = options.params.cursor;
  }

  let query = `SELECT ${select} FROM ${options.table}`;
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += ` ORDER BY ${orderBy} LIMIT $limit`;
  if (options.fetch) query += ` FETCH ${options.fetch}`;

  const result = await db.query<[T[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const lastItem = data[data.length - 1] as Record<string, unknown> | undefined;
  const nextCursorValue = lastItem?.[field] ?? null;

  return {
    data,
    nextCursor: hasMore ? String(nextCursorValue) : null,
    prevCursor: options.params.cursor ?? null,
  };
}
