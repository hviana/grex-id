import { getDb } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("crypto-queries");

/**
 * Generates an Argon2 password hash via SurrealDB's built-in crypto function.
 * The plaintext password never leaves the database layer.
 */
export async function argon2Hash(plaintext: string): Promise<string> {
  const db = await getDb();
  const result = await db.query<[string]>(
    "SELECT VALUE crypto::argon2::generate($plain)",
    { plain: plaintext },
  );
  return result[0];
}
