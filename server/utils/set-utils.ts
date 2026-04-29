import { assertServerOnly } from "./server-only.ts";

assertServerOnly("set-utils");

/** Convert a SurrealDB set/array value to a plain string array. */
export function setToArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return [...v].map(String);
  return [];
}

/** Return the first element of a SurrealDB set/array, or the value itself if
 * it's a plain string. */
export function firstSetElement(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof Set) {
    const first = [...v][0];
    return first ? String(first) : "";
  }
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}
