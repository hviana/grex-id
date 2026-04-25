import { getDb, rid } from "../connection.ts";
import type { User } from "@/src/contracts/user";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("users");

/**
 * Lists users scoped to a specific (company, system) tenant, including
 * per-tenant context roles from `user_company_system`. Cursor-paginated.
 */
export async function getUsersForTenant(params: {
  companyId: string;
  systemId: string;
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
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    limit: params.limit + 1,
  };

  let query = `SELECT id, profileId, channelIds, createdAt,
       (SELECT VALUE name FROM role WHERE id IN (SELECT VALUE roleIds FROM user_company_system
         WHERE userId = $parent.id AND companyId = $companyId AND systemId = $systemId LIMIT 1)[0]) AS contextRoles
     FROM user
     WHERE id IN (SELECT VALUE userId FROM user_company_system
       WHERE companyId = $companyId AND systemId = $systemId)`;

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
 * Returns the context roles for a user in a specific (company, system) tenant.
 */
export async function getUserContext(
  userId: string,
  companyId: string,
  systemId: string,
): Promise<string[]> {
  const db = await getDb();
  const result = await db.query<[string[]]>(
    `SELECT VALUE name FROM role WHERE id IN (SELECT VALUE roleIds FROM user_company_system
     WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
     LIMIT 1)[0]`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
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
 * Idempotently associates an existing user with a (company, system) tenant,
 * creating or updating the `user_company_system` roles. Returns notification
 * metadata (system name, company name, inviter/invitee names).
 */
export async function inviteExistingUser(params: {
  userId: string;
  companyId: string;
  systemId: string;
  roles: string[];
  inviterId: string;
}): Promise<InviteExistingUserResult> {
  const db = await getDb();
  const batchResult = await db.query<
    [
      unknown,
      unknown,
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
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames AND systemId = $systemId);
     IF array::len((SELECT id FROM company_user WHERE companyId = $companyId AND userId = $userId)) = 0 {
       CREATE company_user SET companyId = $companyId, userId = $userId;
     };
     IF array::len((SELECT id FROM user_company_system WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId)) = 0 {
       CREATE user_company_system SET userId = $userId, companyId = $companyId, systemId = $systemId, roleIds = $resolvedRoleIds;
     } ELSE {
       UPDATE user_company_system SET roleIds = $resolvedRoleIds
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
     };
     LET $sys = (SELECT name FROM system WHERE id = $systemId LIMIT 1);
     LET $comp = (SELECT name FROM company WHERE id = $companyId LIMIT 1);
     LET $inviter = (SELECT profileId.name AS profileName FROM user WHERE id = $inviterId LIMIT 1 FETCH profileId);
     LET $invitee = (SELECT profileId.name AS profileName FROM user WHERE id = $userId LIMIT 1 FETCH profileId);
     RETURN {sys: $sys, comp: $comp, inviter: $inviter, invitee: $invitee};`,
    {
      userId: rid(params.userId),
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
 * Creates `company_user` and `user_company_system` associations for a newly
 * created user in a single batched query (§7.2).
 */
export async function createTenantAssociations(params: {
  userId: string;
  companyId: string;
  systemId: string;
  roles: string[];
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames AND systemId = $systemId);
     CREATE company_user SET companyId = $companyId, userId = $userId;
     CREATE user_company_system SET
       userId = $userId,
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
 * Updates the roles for a user in a (company, system) tenant, enforcing the
 * admin invariant: there must be at least one remaining admin after the update.
 * Returns `null` on success, or an i18n error key when the update was blocked.
 */
export async function updateUserRolesWithAdminCheck(params: {
  userId: string;
  companyId: string;
  systemId: string;
  roles: string[];
}): Promise<string | null> {
  const db = await getDb();
  const res = await db.query(
    `LET $resolvedRoleIds = (SELECT VALUE id FROM role WHERE name IN $roleNames AND systemId = $systemId);
     LET $adminRoleId = (SELECT VALUE id FROM role WHERE name = "admin" AND systemId = $systemId LIMIT 1)[0];
     LET $ac = (SELECT count() AS c FROM user_company_system
       WHERE companyId = $companyId AND systemId = $systemId
         AND roleIds CONTAINS $adminRoleId AND userId != $userId)[0].c;
     IF $ac > 0 OR $resolvedRoleIds CONTAINS $adminRoleId {
       UPDATE user_company_system SET roleIds = $resolvedRoleIds
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
     };
     RETURN $ac;`,
    {
      userId: rid(params.userId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
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
 * Removes a user from a (company, system) tenant, enforcing the admin
 * invariant: the sole admin cannot be removed. Returns `null` on success,
 * or an i18n error key when the deletion was blocked.
 */
export async function deleteUserWithAdminCheck(params: {
  userId: string;
  companyId: string;
  systemId: string;
}): Promise<string | null> {
  const db = await getDb();
  const res = await db.query(
    `LET $adminRoleId = (SELECT VALUE id FROM role WHERE name = "admin" AND systemId = $systemId LIMIT 1)[0];
     LET $isTargetAdmin = (SELECT count() AS c FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
         AND roleIds CONTAINS $adminRoleId LIMIT 1)[0].c;
     LET $ac = (SELECT count() AS c FROM user_company_system
       WHERE companyId = $companyId AND systemId = $systemId
         AND roleIds CONTAINS $adminRoleId AND userId != $userId)[0].c;
     IF $isTargetAdmin = 0 OR $ac > 0 {
       DELETE user_company_system
         WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId;
       LET $remainingInCompany = (SELECT count() AS c FROM user_company_system
         WHERE userId = $userId AND companyId = $companyId)[0].c;
       IF $remainingInCompany = 0 {
         DELETE company_user WHERE userId = $userId AND companyId = $companyId;
       };
     };
     RETURN [$isTargetAdmin, $ac];`,
    {
      userId: rid(params.userId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
    },
  );
  const [isTargetAdmin, otherAdmins] = res[res.length - 1] as [number, number];

  if (isTargetAdmin > 0 && otherAdmins === 0) {
    return "users.error.lastAdminDelete";
  }
  return null;
}

/**
 * Updates a user's profile name by following the `user → profile` record link.
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
  age?: unknown;
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
  if (params.age !== undefined) {
    profileSets.push("age = $age");
    profileBindings.age = params.age ? Number(params.age) : null;
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
        age?: number;
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
    if (data.profile.age !== undefined) {
      profileSets.push("age = $age");
      bindings.age = data.profile.age || undefined;
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
                  ELSE (SELECT recoveryChannelIds FROM $usr.profile)[0]
                  END;
     LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recoveryChannelIds END;
     DELETE verification_request WHERE ownerId = $id;
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
    `LET $tenantCount = (SELECT count() AS c FROM company_user
       WHERE userId = $id)[0].c;
     IF $tenantCount = 0 {
       LET $usr  = (SELECT profileId, channelIds FROM $id)[0];
       LET $chIds = IF $usr = NONE THEN [] ELSE $usr.channelIds END;
       LET $prof  = IF $usr = NONE OR $usr.profileId = NONE
                    THEN NONE
                    ELSE (SELECT recoveryChannelIds FROM $usr.profile)[0]
                    END;
       LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recoveryChannelIds END;
       DELETE verification_request WHERE ownerId = $id;
       DELETE user_company_system WHERE userId = $id;
       DELETE company_user WHERE userId = $id;
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
