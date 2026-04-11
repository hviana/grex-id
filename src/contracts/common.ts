export interface CursorParams {
  cursor?: string;
  limit: number;
  direction?: "next" | "prev";
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "phone"
  | "url"
  | "currency"
  | "file"
  | "json";
