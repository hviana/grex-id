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

export interface FieldMapEntry {
  type: FieldType;
  label?: string;
}
