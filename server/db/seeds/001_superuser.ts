import "server-only";

import type { Surreal } from "../connection.ts";

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
       recoveryChannelIds = <set>[];

     // 2. Core company (no ownerId — owner resolved via tenant.isOwner)
     LET $coreCompany = CREATE company SET
       name = "Core",
       document = "core-platform",
       documentType = "system";

     // 3. Core system
     LET $coreSystem = CREATE system SET
       name = "Core",
       slug = "core",
       logoUri = "";

     // 4. System-level tenant row for core system (actorId=NONE, companyId=NONE, systemId=core)
     LET $coreSystemTenant = CREATE tenant SET
       actorId = NONE,
       companyId = NONE,
       systemId = $coreSystem[0].id;

     // 5. Company-system tenant row (actorId=NONE)
     LET $coreCompanySystemTenant = CREATE tenant SET
       actorId = NONE,
       companyId = $coreCompany[0].id,
       systemId = $coreSystem[0].id;

     // 6. Superuser role linked to core system-level tenant
     LET $superuserRole = CREATE role SET
       name = "superuser",
       tenantIds = {$coreSystemTenant[0].id,},
       granular = false;

     // 7. Anonymous role for public API token
     LET $anonymousRole = CREATE role SET
       name = "anonymous",
       tenantIds = {$coreSystemTenant[0].id,},
       granular = false;

     // 8. Resource limits
     LET $superuserRl = CREATE resource_limit SET
       roleIds = {$superuserRole[0].id,};
     LET $anonymousRl = CREATE resource_limit SET
       roleIds = {$anonymousRole[0].id,};

     // 9. Superuser user
     LET $usr = CREATE user SET
       passwordHash = crypto::argon2::generate($password),
       profileId = $prof[0].id,
       channelIds = {$ch[0].id,},
       twoFactorEnabled = false,
       stayLoggedIn = false,
       resourceLimitId = $superuserRl[0].id,
       tenantIds = <set>[];

     // 10. Company-membership tenant row (user + company, systemId=NONE, isOwner=true)
     LET $userCompanyTenant = CREATE tenant SET
       actorId = $usr[0].id,
       companyId = $coreCompany[0].id,
       systemId = NONE,
       isOwner = true;

     // 11. User-access tenant row (user + company + system)
     LET $userCompanySystemTenant = CREATE tenant SET
       actorId = $usr[0].id,
       companyId = $coreCompany[0].id,
       systemId = $coreSystem[0].id;

     // 12. Anonymous API token
     CREATE api_token:anonymous SET
       tenantIds = {$coreCompanySystemTenant[0].id,},
       name = "Anonymous Token",
       actorType = "token",
       resourceLimitId = $anonymousRl[0].id,
       neverExpires = true;`,
    { name, password, email },
  );

  console.log(
    `[seed] core infrastructure created: company, system (slug "core"), tenant rows, superuser + anonymous roles, resource limits, superuser (${email}), anonymous API token`,
  );
}
