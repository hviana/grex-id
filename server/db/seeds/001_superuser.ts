import type { Surreal } from "surrealdb";

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
    `LET $prof = CREATE profile SET name = $name, channels = [];
     LET $usr = CREATE user SET
       passwordHash = crypto::argon2::generate($password),
       profile = $prof[0].id,
       roles = ["superuser", "admin"],
       twoFactorEnabled = false,
       stayLoggedIn = false;
     LET $ch = CREATE entity_channel SET
       ownerId = $usr[0].id,
       ownerType = "user",
       type = "email",
       value = $email,
       verified = true;
     UPDATE $prof[0].id SET channels = [$ch[0].id], updatedAt = time::now();`,
    { name, password, email },
  );

  console.log(`[seed] superuser created: ${email}`);
}
