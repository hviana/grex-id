import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("001_superuser");

export async function seed(db: Surreal): Promise<void> {
  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM system WHERE slug = "core" LIMIT 1`,
  );
  if ((existing[0] ?? []).length > 0) {
    console.log("[seed] core infrastructure already exists, skipping");
    return;
  }

  const email = "core@admin.com";
  const password = "core1234";
  const name = "Super Admin";

  await db.query(
    // 1. Superuser user (profile + verified email channel)
    `LET $ch = CREATE entity_channel SET
       type = "email",
       value = $email,
       verified = true;
     LET $prof = CREATE profile SET
       name = $name,
       recoveryChannelIds = [];
     LET $usr = CREATE user SET
       passwordHash = crypto::argon2::generate($password),
       profileId = $prof[0].id,
       channelIds = [$ch[0].id],
       twoFactorEnabled = false,
       stayLoggedIn = false;

     // 2. Core company (owned by superuser)
     LET $coreCompany = CREATE company SET
       name = "Core",
       document = "core-platform",
       documentType = "system",
       ownerId = $usr[0].id;

     // 3. Core system
     LET $coreSystem = CREATE system SET
       name = "Core",
       slug = "core",
       logoUri = "";

     // 4. Built-in roles for core system
     LET $superuserRole = CREATE role SET
       name = "superuser",
       systemId = $coreSystem[0].id,
       permissions = ["*"],
       isBuiltIn = true;
     LET $anonymousRole = CREATE role SET
       name = "anonymous",
       systemId = $coreSystem[0].id,
       permissions = [],
       isBuiltIn = true;

     // 5. Superuser tenant membership
     CREATE user_company_system SET
       userId = $usr[0].id,
       companyId = $coreCompany[0].id,
       systemId = $coreSystem[0].id,
       roleIds = [$superuserRole[0].id];

     // 6. Anonymous user (no profile, no channels, no password)
     LET $anonUser = CREATE user SET
       passwordHash = NONE,
       profileId = NONE,
       channelIds = [],
       twoFactorEnabled = false,
       stayLoggedIn = false;

     // 7. Anonymous user's long-lived API token
     CREATE api_token:anonymous SET
       userId = $anonUser[0].id,
       companyId = $coreCompany[0].id,
       systemId = $coreSystem[0].id,
       name = "Anonymous Token",
       permissions = [],
       neverExpires = true,
       frontendUse = false,
       frontendDomains = [];

     // 8. Anonymous user tenant membership
     CREATE user_company_system SET
       userId = $anonUser[0].id,
       companyId = $coreCompany[0].id,
       systemId = $coreSystem[0].id,
       roleIds = [$anonymousRole[0].id];`,
    { name, password, email },
  );

  console.log(
    `[seed] core infrastructure created: company, system (slug "core"), roles (superuser, anonymous), superuser (${email}), anonymous user + token`,
  );
}
