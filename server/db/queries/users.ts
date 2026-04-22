import { getDb, rid } from "../connection.ts";
import type { User } from "@/src/contracts/user";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { paginatedQuery } from "./pagination.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("users");

export async function listUsers(
  params: CursorParams & { search?: string; companyId?: string },
): Promise<
  PaginatedResult<
    Omit<User, "twoFactorEnabled" | "stayLoggedIn">
  >
> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

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

  return paginatedQuery<
    Omit<User, "twoFactorEnabled" | "stayLoggedIn">
  >({
    table: "user",
    select: "id, profile, roles, createdAt, updatedAt",
    conditions,
    bindings,
    fetch: "profile, channels",
    params,
  });
}

export async function getUser(id: string): Promise<User | null> {
  const db = await getDb();
  const result = await db.query<[User[]]>(
    "SELECT * FROM $id FETCH profile, channels",
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
      roles: string[];
    }
  >,
): Promise<User> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.roles !== undefined) {
    sets.push("roles = $roles");
    bindings.roles = data.roles;
  }

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

  statements.push("SELECT * FROM $id FETCH profile, channels");

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
    `LET $usr  = (SELECT profile, channels FROM $id)[0];
     LET $chIds = IF $usr = NONE THEN [] ELSE $usr.channels END;
     LET $prof  = IF $usr = NONE OR $usr.profile = NONE
                  THEN NONE
                  ELSE (SELECT recovery_channels FROM $usr.profile)[0]
                  END;
     LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recovery_channels END;
     DELETE verification_request WHERE ownerId = $id;
     DELETE $id;
     FOR $cid IN $chIds { DELETE $cid; };
     FOR $rid IN $recIds { DELETE $rid; };
     IF $usr != NONE AND $usr.profile != NONE {
       DELETE $usr.profile;
     };`,
    { id: rid(id) },
  );
}
