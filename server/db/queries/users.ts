import { getDb, rid } from "../connection.ts";
import type { User } from "@/src/contracts/user";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("users");

/**
 * Lists users scoped to a specific tenant, including per-tenant context roles
 * from `tenant.roleIds`. Cursor-paginated.
 */
export async function getUsersForTenant(params: {
  tenantId: string;
  search?: string;
  cursor?: string;
  direction?: string;
  limit: number;
}): Promise<{
  data: Record<string, unknown>[];
  nextCursor: string | null;
}> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {
    tenantId: rid(params.tenantId),
    limit: params.limit + 1,
  };

  let query = `SELECT id, profileId, channelIds, createdAt,
       (SELECT VALUE name FROM role WHERE id IN (SELECT VALUE roleIds FROM tenant
         WHERE id = $tenantId AND actorId = $parent.id LIMIT 1)) AS contextRoles
     FROM user
     WHERE id IN (SELECT VALUE actorId FROM tenant
       WHERE id = $tenantId AND actorId != NONE)`;

  if (params.search) {
    query += " AND profileId.name @@ $search";
    bindings.search = params.search;
  }
  if (params.cursor) {
    query += " AND id > $cursor";
    bindings.cursor = params.cursor;
  }

  query += " ORDER BY createdAt DESC LIMIT $limit FETCH profileId, channelIds";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > params.limit;
  const data = hasMore ? items.slice(0, params.limit) : items;

  return {
    data,
    nextCursor: hasMore && data.length > 0
      ? String((data[data.length - 1] as Record<string, unknown>).id)
      : null,
  };
}

/**
 * Lists users without tenant scoping (global list). Cursor-paginated.
 */
export async function getUsersNoTenant(params: {
  search?: string;
  cursor?: string;
  limit: number;
}): Promise<{
  data: Record<string, unknown>[];
  nextCursor: string | null;
}> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { limit: params.limit + 1 };
  const conditions: string[] = [];

  if (params.search) {
    conditions.push("profileId.name @@ $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push("id > $cursor");
    bindings.cursor = params.cursor;
  }

  let query = "SELECT id, profileId, channelIds, createdAt FROM user";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit FETCH profileId, channelIds";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > params.limit;
  const data = hasMore ? items.slice(0, params.limit) : items;

  return {
    data,
    nextCursor: hasMore && data.length > 0
      ? String((data[data.length - 1] as Record<string, unknown>).id)
      : null,
  };
}

/**
 * Returns the context roles for a user in a specific tenant.
 */
export async function getUserContext(
  userId: string,
  tenantId: string,
): Promise<string[]> {
  const db = await getDb();
  const result = await db.query<[string[]]>(
    `SELECT VALUE name FROM role WHERE id IN (
       SELECT VALUE roleIds FROM tenant
       WHERE id = $tenantId
       LIMIT 1
     )`,
    {
      userId: rid(userId),
      tenantId: rid(tenantId),
    },
  );
  return result[0] ?? [];
}

/**
 * Result of inviting an existing user to a tenant, including data needed
 * for the notification message.
 */
export interface InviteExistingUserResult {
  systemName: string;
  companyName: string;
  inviterName: string;
  inviteeName: string;
}

/**
 * Idempotently associates an existing user with a tenant by creating a
 * user-access tenant row with `roleIds` entries. Returns notification
 * metadata (system name, company name, inviter/invitee names).
 */
export async function inviteExistingUser(params: {
  userId: string;
  tenantId: string;
  roles: string[];
  inviterId: string;
  companyId: string;
  systemId: string;
}): Promise<InviteExistingUserResult> {
  const db = await getDb();
  const batchResult = await db.query<
    [
      unknown,
      unknown,
      unknown,
      unknown,
      unknown,
      {
        sys: { name: string }[];
        comp: { name: string }[];
        inviter: { profileName?: string }[];
        invitee: { profileName?: string }[];
      },
    ]
  >(
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames AND tenantIds CONTAINS $systemTenantId);
     LET $existingUserTenant = (SELECT id FROM tenant WHERE id = $tenantId AND actorId = $userId LIMIT 1);
     IF array::len($existingUserTenant) = 0 {
       CREATE tenant SET
         actorId = $userId,
         companyId = $companyId,
         systemId = $systemId,
         roleIds = $resolvedRoleIds;
     };
     LET $sys = (SELECT name FROM system WHERE id = $systemId LIMIT 1);
     LET $comp = (SELECT name FROM company WHERE id = $companyId LIMIT 1);
     LET $inviter = (SELECT profileId.name AS profileName FROM user WHERE id = $inviterId LIMIT 1 FETCH profileId);
     LET $invitee = (SELECT profileId.name AS profileName FROM user WHERE id = $userId LIMIT 1 FETCH profileId);
     RETURN {sys: $sys, comp: $comp, inviter: $inviter, invitee: $invitee};`,
    {
      userId: rid(params.userId),
      tenantId: rid(params.tenantId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      roleNames: params.roles,
      inviterId: rid(params.inviterId),
    },
  );

  const returnData = batchResult[batchResult.length - 1] as {
    sys: { name: string }[];
    comp: { name: string }[];
    inviter: { profileName?: string }[];
    invitee: { profileName?: string }[];
  };
  return {
    systemName: returnData?.sys?.[0]?.name ?? "",
    companyName: returnData?.comp?.[0]?.name ?? "",
    inviterName: returnData?.inviter?.[0]?.profileName ?? "",
    inviteeName: returnData?.invitee?.[0]?.profileName ?? "",
  };
}

/**
 * Creates a company-membership tenant row and a user-access tenant row
 * with `roleIds` for a newly created user in a single batched
 * query (§2.4).
 */
export async function createTenantAssociations(params: {
  userId: string;
  companyId: string;
  systemId: string;
  roles: string[];
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames AND tenantIds CONTAINS $systemTenantId);
     LET $companyTenant = (SELECT id FROM tenant WHERE actorId = NONE AND companyId = $companyId AND systemId = NONE LIMIT 1);
     IF array::len($companyTenant) = 0 {
       CREATE tenant SET actorId = $userId, companyId = $companyId, systemId = NONE, isOwner = true;
     };
     CREATE tenant SET
       actorId = $userId,
       companyId = $companyId,
       systemId = $systemId,
       roleIds = $resolvedRoleIds;`,
    {
      userId: rid(params.userId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      roleNames: params.roles,
    },
  );
}

/**
 * Updates the roles for a user in a tenant, enforcing the admin invariant:
 * there must be at least one remaining admin after the update.
 * Returns `null` on success, or an i18n error key when the update was blocked.
 */
export async function updateUserRolesWithAdminCheck(params: {
  userId: string;
  tenantId: string;
  roles: string[];
}): Promise<string | null> {
  const db = await getDb();
  const res = await db.query(
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames);
     LET $adminRoleId = (SELECT VALUE id FROM role WHERE name = "admin" LIMIT 1)[0];
     LET $otherTenantsWithAdmin = (SELECT count() AS c FROM tenant
       WHERE id != $tenantId
         AND actorId != NONE
         AND roleIds CONTAINS $adminRoleId
         AND companyId = (SELECT VALUE companyId FROM tenant WHERE id = $tenantId LIMIT 1)[0]
         AND systemId = (SELECT VALUE systemId FROM tenant WHERE id = $tenantId LIMIT 1)[0]
       LIMIT 1)[0].c;
     LET $ac = $otherTenantsWithAdmin ?? 0;
     IF $ac > 0 OR $resolvedRoleIds CONTAINS $adminRoleId {
       UPDATE $tenantId SET roleIds = $resolvedRoleIds;
     };
     RETURN $ac;`,
    {
      userId: rid(params.userId),
      tenantId: rid(params.tenantId),
      roleNames: params.roles,
    },
  );
  const otherAdmins = res[res.length - 1] as number;
  if (otherAdmins === 0 && !params.roles.includes("admin")) {
    return "users.error.lastAdminRole";
  }
  return null;
}

/**
 * Removes a user from a tenant, enforcing the admin invariant: the sole
 * admin cannot be removed. Returns `null` on success, or an i18n error key
 * when the deletion was blocked.
 */
export async function deleteUserWithAdminCheck(params: {
  userId: string;
  tenantId: string;
}): Promise<string | null> {
  const db = await getDb();
  const res = await db.query(
    `LET $adminRoleId = (SELECT VALUE id FROM role WHERE name = "admin" LIMIT 1)[0];
     LET $tenant = (SELECT roleIds FROM tenant WHERE id = $tenantId LIMIT 1)[0];
     LET $isTargetAdmin = IF $tenant != NONE AND $tenant.roleIds CONTAINS $adminRoleId THEN 1 ELSE 0 END;
     LET $otherAdminCount = (SELECT count() AS c FROM tenant
       WHERE id != $tenantId
         AND actorId != NONE
         AND roleIds CONTAINS $adminRoleId
         AND companyId = (SELECT VALUE companyId FROM tenant WHERE id = $tenantId LIMIT 1)[0]
         AND systemId = (SELECT VALUE systemId FROM tenant WHERE id = $tenantId LIMIT 1)[0]
       LIMIT 1)[0].c;
     LET $ac = $otherAdminCount ?? 0;
     IF $isTargetAdmin = 0 OR $ac > 0 {
       DELETE $tenantId;
     };
     RETURN [$isTargetAdmin, $ac];`,
    {
      userId: rid(params.userId),
      tenantId: rid(params.tenantId),
    },
  );
  const [isTargetAdmin, otherAdmins] = res[res.length - 1] as [number, number];

  if (isTargetAdmin > 0 && otherAdmins === 0) {
    return "users.error.lastAdminDelete";
  }
  return null;
}

/**
 * Updates a user's profile name by following the `user -> profile` record link.
 */
export async function updateUserProfileName(
  userId: string,
  name: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $prof = (SELECT profileId FROM $id);
     UPDATE $prof[0].profileId SET name = $name, updatedAt = time::now()`,
    { id: rid(userId), name },
  );
}

/**
 * Updates multiple profile fields for the current user, returning the updated
 * user row with profile and channels resolved.
 */
export async function updateCurrentUserProfile(params: {
  userId: string;
  name?: string;
  avatarUri?: string;
  dateOfBirth?: unknown;
}): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const profileSets: string[] = ["updatedAt = time::now()"];
  const profileBindings: Record<string, unknown> = {
    userId: rid(params.userId),
  };

  if (params.name !== undefined) {
    profileSets.push("name = $name");
    profileBindings.name = params.name;
  }
  if (params.avatarUri !== undefined) {
    profileSets.push("avatarUri = $avatarUri");
    profileBindings.avatarUri = params.avatarUri || null;
  }
  if (params.dateOfBirth !== undefined) {
    profileSets.push("dateOfBirth = $dateOfBirth");
    profileBindings.dateOfBirth = params.dateOfBirth
      ? `<datetime>${params.dateOfBirth}`
      : null;
  }

  const stmts = [
    `LET $prof = (SELECT profileId FROM user WHERE id = $userId)[0].profileId`,
    `UPDATE $prof SET ${profileSets.join(", ")}`,
    `UPDATE $userId SET updatedAt = time::now()`,
    `SELECT * FROM $userId FETCH profileId, channelIds`,
  ];
  const result = await db.query<Record<string, unknown>[][]>(
    stmts.join(";\n"),
    profileBindings,
  );
  const updatedUser = result[result.length - 1]?.[0];
  return updatedUser ?? null;
}

export async function getUser(id: string): Promise<User | null> {
  const db = await getDb();
  const result = await db.query<[User[]]>(
    "SELECT * FROM $id FETCH profileId, channelIds",
    { id: rid(id) },
  );
  return result[0]?.[0] ?? null;
}

export async function updateUser(
  id: string,
  data: Partial<
    {
      profile: {
        name: string;
        avatarUri?: string;
        dateOfBirth?: string;
        locale?: string;
      };
    }
  >,
): Promise<User> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  const statements: string[] = [];

  if (data.profile !== undefined) {
    const profileSets: string[] = ["updatedAt = time::now()"];
    if (data.profile.name !== undefined) {
      profileSets.push("name = $profileName");
      bindings.profileName = data.profile.name;
    }
    if (data.profile.avatarUri !== undefined) {
      profileSets.push("avatarUri = $avatarUri");
      bindings.avatarUri = data.profile.avatarUri || undefined;
    }
    if (data.profile.dateOfBirth !== undefined) {
      profileSets.push("dateOfBirth = $dateOfBirth");
      bindings.dateOfBirth = data.profile.dateOfBirth
        ? `<datetime>${data.profile.dateOfBirth}`
        : undefined;
    }
    if (data.profile.locale !== undefined) {
      profileSets.push("locale = $locale");
      bindings.locale = data.profile.locale || undefined;
    }
    statements.push(
      `LET $usr = (SELECT profileId FROM $id);
      IF $usr[0].profileId != NONE {
        UPDATE $usr[0].profileId SET ${profileSets.join(", ")};
      }`,
    );
  }

  if (sets.length > 0) {
    sets.push("updatedAt = time::now()");
    statements.push(`UPDATE $id SET ${sets.join(", ")}`);
  }

  statements.push("SELECT * FROM $id FETCH profileId, channelIds");

  const results = await db.query<unknown[]>(
    statements.join(";\n") + ";",
    bindings,
  );
  const selectResult = results[results.length - 1] as User[];
  return selectResult[0];
}

export async function updateUserLocale(
  id: string,
  locale: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $usr = (SELECT profileId FROM $id);
    IF $usr[0].profileId != NONE {
      UPDATE $usr[0].profileId SET locale = $locale, updatedAt = time::now();
    };
    UPDATE $id SET updatedAt = time::now();`,
    { id: rid(id), locale },
  );
}

export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $usr  = (SELECT profileId, channelIds FROM $id)[0];
     LET $chIds = IF $usr = NONE THEN [] ELSE $usr.channelIds END;
     LET $prof  = IF $usr = NONE OR $usr.profileId = NONE
                  THEN NONE
                  ELSE (SELECT recoveryChannelIds FROM $usr.profileId)[0]
                  END;
     LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recoveryChannelIds END;
     DELETE verification_request WHERE ownerId = $id;
     DELETE tenant WHERE actorId = $id;
     DELETE $id;
     FOR $cid IN $chIds { DELETE $cid; };
     FOR $rid IN $recIds { DELETE $rid; };
     IF $usr != NONE AND $usr.profileId != NONE {
       DELETE $usr.profileId;
     };`,
    { id: rid(id) },
  );
}

export async function hardDeleteUserIfOrphaned(
  userId: string,
): Promise<boolean> {
  const db = await getDb();
  const res = await db.query(
    `LET $tenantCount = (SELECT count() AS c FROM tenant
       WHERE actorId = $id AND companyId != NONE)[0].c;
     IF $tenantCount = 0 {
       LET $usr  = (SELECT profileId, channelIds FROM $id)[0];
       LET $chIds = IF $usr = NONE THEN [] ELSE $usr.channelIds END;
       LET $prof  = IF $usr = NONE OR $usr.profileId = NONE
                    THEN NONE
                    ELSE (SELECT recoveryChannelIds FROM $usr.profileId)[0]
                    END;
       LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recoveryChannelIds END;
       DELETE verification_request WHERE ownerId = $id;
       DELETE tenant WHERE actorId = $id;
       DELETE $id;
       FOR $cid IN $chIds { DELETE $cid; };
       FOR $rid IN $recIds { DELETE $rid; };
       IF $usr != NONE AND $usr.profileId != NONE {
         DELETE $usr.profileId;
       };
     };
     RETURN $tenantCount;`,
    { id: rid(userId) },
  );
  return (res[res.length - 1] as number) === 0;
}
