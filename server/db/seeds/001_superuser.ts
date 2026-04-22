import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("001_superuser");

export async function seed(db: Surreal): Promise<void> {
  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM user WHERE roles CONTAINS "superuser" LIMIT 1`,
  );
  if ((existing[0] ?? []).length > 0) {
    console.log("[seed] superuser already exists, skipping");
    return;
  }

  const email = "core@admin.com";
  const password = "core1234";
  const name = "Super Admin";

  await db.query(
    `LET $ch   = CREATE entity_channel SET
       type = "email",
       value = $email,
       verified = true;
     LET $prof = CREATE profile SET
       name = $name,
       recovery_channels = [];
     LET $usr  = CREATE user SET
       passwordHash = crypto::argon2::generate($password),
       profile = $prof[0].id,
       channels = [$ch[0].id],
       roles = ["superuser", "admin"],
       twoFactorEnabled = false,
       stayLoggedIn = false;`,
    { name, password, email },
  );

  console.log(`[seed] superuser created: ${email}`);
}
