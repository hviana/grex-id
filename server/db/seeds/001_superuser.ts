import type { Surreal } from "surrealdb";

export async function seed(db: Surreal): Promise<void> {
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
