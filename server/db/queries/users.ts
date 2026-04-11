import { getDb, rid } from "../connection";
import type { User } from "@/src/contracts/user";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

export async function listUsers(
  params: CursorParams & { search?: string; companyId?: string },
): Promise<
  PaginatedResult<
    Omit<User, "twoFactorEnabled" | "oauthProvider" | "stayLoggedIn">
  >
> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (params.companyId) {
    conditions.push(
      "id IN (SELECT userId FROM company_user WHERE companyId = $companyId)",
    );
    bindings.companyId = params.companyId;
  }
  if (params.search) {
    conditions.push("profile.name @@ $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  let query =
    "SELECT id, email, emailVerified, phone, phoneVerified, profile, roles, createdAt, updatedAt FROM user";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit FETCH profile";

  const result = await db.query<
    [Omit<User, "twoFactorEnabled" | "oauthProvider" | "stayLoggedIn">[]]
  >(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function getUser(id: string): Promise<User | null> {
  const db = await getDb();
  const result = await db.query<[User[]]>(
    "SELECT * FROM $id FETCH profile",
    { id: rid(id) },
  );
  return result[0]?.[0] ?? null;
}

export async function updateUser(
  id: string,
  data: Partial<
    {
      email: string;
      phone: string;
      profile: {
        name: string;
        avatarUri?: string;
        age?: number;
        locale?: string;
      };
      roles: string[];
    }
  >,
): Promise<User> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.email !== undefined) {
    sets.push("email = $email");
    bindings.email = data.email;
  }
  if (data.phone !== undefined) {
    sets.push("phone = $phone");
    bindings.phone = data.phone;
  }
  if (data.roles !== undefined) {
    sets.push("roles = $roles");
    bindings.roles = data.roles;
  }

  // Build a single batched query for all updates
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
      `LET $usr = (SELECT profile FROM $id);
      IF $usr[0].profile != NONE {
        UPDATE $usr[0].profile SET ${profileSets.join(", ")};
      }`,
    );
  }

  if (sets.length > 0) {
    sets.push("updatedAt = time::now()");
    statements.push(`UPDATE $id SET ${sets.join(", ")}`);
  }

  statements.push("SELECT * FROM $id FETCH profile");

  const results = await db.query<unknown[]>(
    statements.join(";\n") + ";",
    bindings,
  );
  // The last statement is always the SELECT
  const selectResult = results[results.length - 1] as User[];
  return selectResult[0];
}

export async function updateUserLocale(
  id: string,
  locale: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $usr = (SELECT profile FROM $id);
    IF $usr[0].profile != NONE {
      UPDATE $usr[0].profile SET locale = $locale, updatedAt = time::now();
    };
    UPDATE $id SET updatedAt = time::now();`,
    { id: rid(id), locale },
  );
}

export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $usr = (SELECT profile FROM $id);
    DELETE $id;
    IF $usr[0].profile != NONE {
      DELETE $usr[0].profile;
    };`,
    { id: rid(id) },
  );
}
