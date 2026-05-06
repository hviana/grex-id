/**
 * Input parameters for cursor-paginated reads.
 */
export interface CursorParams {
  /**
   * Page size requested by the caller. Implementations may cap this further
   * via their own `opts.limit`. Defaults to 20 when omitted.
   */
  limit?: number;
  /**
   * Opaque cursor returned as `nextCursor` from a previous page. Pass it back
   * as-is to fetch the next page. Stringified record ids (e.g. `"task:abc"`)
   * are detected and rehydrated server-side.
   */
  cursor?: string;
}

/**
 * Result of a cursor-paginated read.
 *
 * `nextCursor` is present iff there is at least one more page; `hasMore`
 * mirrors that as a boolean for convenience. `total` reflects the full
 * filtered result set (search + tenant + date + tag filters), independent
 * of the current page's cursor.
 */
export interface PaginatedResult<T> {
  /** Rows on the current page, in the requested order. */
  items: T[];
  /** Total rows matching the filters, ignoring cursor/limit. */
  total: number;
  /** True when another page is available — equivalent to `nextCursor != null`. */
  hasMore: boolean;
  /** Cursor to pass back as `params.cursor` for the next page. */
  nextCursor?: string;
}
