import type { Surreal } from "surrealdb";

export async function seedSuperuser(db: Surreal): Promise<void> {
  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM user WHERE roles CONTAINS "superuser" LIMIT 1`,
  );

  if (existing[0] && existing[0].length > 0) {
    console.log("[seed] superuser already exists, skipping.");
    return;
  }

  const email = "core@admin.com";
  const password = "core1234";
  const name = "Super Admin";

  const profileResult = await db.query<[{ id: string }[]]>(
    `CREATE profile SET name = $name`,
    { name },
  );
  const profileId = profileResult[0][0].id;

  await db.query(
    `CREATE user SET
      email = $email,
      emailVerified = true,
      passwordHash = crypto::argon2::generate($password),
      profile = $profileId,
      roles = ["superuser", "admin"],
      twoFactorEnabled = false,
      stayLoggedIn = false`,
    { email, password, profileId },
  );

  console.log(`[seed] superuser created: ${email}`);
}
