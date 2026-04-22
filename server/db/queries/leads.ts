import { getDb, rid } from "../connection.ts";
import type { Lead, LeadCompanySystem } from "@/src/contracts/lead";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";
import { runLifecycleHooks } from "@/server/module-registry";

function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();
  if (isRecordId(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string" && typeof record.id === "string") {
      return `${record.tb}:${record.id}`;
    }
    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }
  }

  return stringified || null;
}

function isRecordId(value: string): boolean {
  return /^[^:\s]+:[^:\s]+$/.test(value);
}

function requireRecordId(value: unknown, field: string): string {
  const id = normalizeRecordId(value);
  if (!id || !isRecordId(id)) {
    throw new Error(`INVALID_RECORD_ID:${field}`);
  }
  return id;
}

function normalizeRecordIds(values: unknown[]): string[] {
  const uniqueIds = new Set<string>();

  for (const value of values) {
    const id = normalizeRecordId(value);
    if (id) {
      uniqueIds.add(id);
    }
  }

  return [...uniqueIds];
}

function normalizeLead<T extends Partial<Lead>>(lead: T | null): T | null {
  if (!lead) return lead;

  const normalizedId = normalizeRecordId((lead as { id?: unknown }).id);

  return {
    ...lead,
    ...(normalizedId ? { id: normalizedId } : {}),
    companyIds: normalizeRecordIds(
      Array.isArray((lead as { companyIds?: unknown[] }).companyIds)
        ? (lead as { companyIds?: unknown[] }).companyIds ?? []
        : [],
    ),
  };
}

async function getLeadCompanyIds(id: string): Promise<string[]> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  const result = await db.query<[{ companyIds?: unknown[] }[]]>(
    "SELECT companyIds FROM lead WHERE id = $id LIMIT 1",
    { id: rid(leadId) },
  );

  const companyIds = result[0]?.[0]?.companyIds;
  return normalizeRecordIds(Array.isArray(companyIds) ? companyIds : []);
}

export async function listLeads(
  params: CursorParams & {
    search?: string;
    companyId: string;
    systemId: string;
  },
): Promise<PaginatedResult<Lead & { ownerId?: string }>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = {
    limit: limit + 1,
    companyId: rid(requireRecordId(params.companyId, "companyId")),
    systemId: rid(requireRecordId(params.systemId, "systemId")),
  };

  let lcsWhere = `companyId = $companyId AND systemId = $systemId`;

  if (params.cursor) {
    lcsWhere += params.direction === "prev"
      ? " AND leadId < $cursor"
      : " AND leadId > $cursor";
    bindings.cursor = rid(requireRecordId(params.cursor, "cursor"));
  }

  let searchClause = "";
  if (params.search) {
    searchClause = " AND name @@ $search";
    bindings.search = params.search;
  }

  const query = `
    LET $lcs = (SELECT leadId, ownerId, createdAt FROM lead_company_system WHERE ${lcsWhere} ORDER BY createdAt DESC LIMIT $limit);
    LET $ids = $lcs.leadId;
    SELECT * FROM lead WHERE id IN $ids${searchClause} FETCH profile, channels, tags;
    SELECT leadId, ownerId FROM lead_company_system WHERE ${lcsWhere};`;

  const result = await db.query<
    [null, null, Lead[], { leadId: unknown; ownerId?: string }[]]
  >(
    query,
    bindings,
  );
  const leads = result[2] ?? [];

  const lcsRows = result[3] ?? [];
  const ownerMap = new Map<string, string | undefined>();
  for (const row of lcsRows) {
    const leadId = normalizeRecordId(row.leadId);
    if (!leadId) continue;
    ownerMap.set(leadId, row.ownerId);
  }

  const hasMore = leads.length > limit;
  const sliced = hasMore ? leads.slice(0, limit) : leads;
  const data = sliced.map((lead) => {
    const normalizedLead = normalizeLead(lead)!;
    return {
      ...normalizedLead,
      ownerId: normalizedLead.id ? ownerMap.get(normalizedLead.id) : undefined,
    };
  });

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  const result = await db.query<[Lead[]]>(
    "SELECT * FROM lead WHERE id = $id LIMIT 1 FETCH profile, channels",
    { id: rid(leadId) },
  );
  return normalizeLead(result[0]?.[0] ?? null);
}

export async function findLeadByChannelValues(
  values: string[],
): Promise<Lead | null> {
  if (values.length === 0) return null;
  const db = await getDb();
  const result = await db.query<[Lead[]]>(
    `LET $chIds = (SELECT id FROM entity_channel WHERE value IN $values).id;
     IF array::len($chIds) = 0 { RETURN []; };
     SELECT * FROM lead
     WHERE channels ANYINSIDE $chIds
     LIMIT 1 FETCH profile, channels;`,
    { values },
  );
  return normalizeLead(result[0]?.[0] ?? null);
}

export async function createLead(data: {
  name: string;
  profile: { name: string; avatarUri?: string; age?: number };
  channels: { type: string; value: string }[];
  companyIds?: string[];
  tags?: string[];
}): Promise<Lead> {
  const db = await getDb();
  const companyIds = normalizeRecordIds(data.companyIds ?? []).map((
    companyId,
  ) => rid(requireRecordId(companyId, "companyId")));

  const channelStmts = data.channels
    .map(
      (_, i) => `
      LET $ch${i} = CREATE entity_channel SET
        type = $ctype${i},
        value = $cvalue${i},
        verified = false;`,
    )
    .join("");

  const channelsArray = data.channels
    .map((_, i) => `$ch${i}[0].id`)
    .join(", ");

  const bindings: Record<string, unknown> = {
    profileName: data.profile.name,
    avatarUri: data.profile.avatarUri ?? undefined,
    age: data.profile.age ?? undefined,
    name: data.name,
    companyIds,
    tags: data.tags ?? [],
  };
  data.channels.forEach((c, i) => {
    bindings[`ctype${i}`] = c.type;
    bindings[`cvalue${i}`] = c.value;
  });

  const query = `
    ${channelStmts}
    LET $prof = CREATE profile SET
      name = $profileName,
      avatarUri = $avatarUri,
      age = $age,
      recovery_channels = [];
    LET $ld = CREATE lead SET
      name = $name,
      profile = $prof[0].id,
      channels = [${channelsArray}],
      companyIds = $companyIds,
      tags = $tags;
    SELECT * FROM $ld[0].id FETCH profile, channels;`;

  const result = await db.query<unknown[]>(query, bindings);
  const last = result[result.length - 1] as Lead[];
  return normalizeLead(last[0])!;
}

export async function updateLead(
  id: string,
  data: {
    name?: string;
    profile?: { name?: string; avatarUri?: string; age?: number };
    companyIds?: string[];
    tags?: string[];
  },
): Promise<Lead> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  const companyIds = data.companyIds !== undefined
    ? normalizeRecordIds(data.companyIds).map((companyId) =>
      requireRecordId(companyId, "companyId")
    )
    : await getLeadCompanyIds(leadId);
  const sets: string[] = ["updatedAt = time::now()"];
  const bindings: Record<string, unknown> = { id: rid(leadId) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.tags !== undefined) {
    sets.push("tags = $tags");
    bindings.tags = data.tags;
  }
  sets.push("companyIds = $companyIds");
  bindings.companyIds = companyIds.map((companyId) => rid(companyId));

  const statements: string[] = [];

  if (data.profile) {
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
    statements.push(
      `LET $ld = (SELECT profile FROM $id);
      IF $ld[0].profile != NONE {
        UPDATE $ld[0].profile SET ${profileSets.join(", ")};
      }`,
    );
  }

  statements.push(`UPDATE $id SET ${sets.join(", ")}`);
  statements.push("SELECT * FROM $id FETCH profile, channels");

  const results = await db.query<unknown[]>(
    statements.join(";\n") + ";",
    bindings,
  );
  const selectResult = results[results.length - 1] as Lead[];
  return normalizeLead(selectResult[0])!;
}

export async function syncLeadCompanyIds(leadId: string): Promise<string[]> {
  const db = await getDb();
  const normalizedLeadId = requireRecordId(leadId, "leadId");

  const result = await db.query<[unknown, { companyId: unknown }[]]>(
    `LET $rows = (SELECT companyId FROM lead_company_system WHERE leadId = $leadId);
     UPDATE $leadId SET companyIds = $rows[*].companyId, updatedAt = time::now();
     SELECT companyId FROM lead_company_system WHERE leadId = $leadId`,
    { leadId: rid(normalizedLeadId) },
  );

  return normalizeRecordIds(
    (result[1] ?? []).map((row: { companyId: unknown }) => row.companyId),
  );
}

export async function deleteLead(id: string): Promise<void> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  await runLifecycleHooks("lead:delete", { leadId });
  await db.query(
    `LET $ld = (SELECT profile, channels FROM lead WHERE id = $id)[0];
     LET $prof = IF $ld = NONE THEN NONE ELSE (SELECT recovery_channels FROM $ld.profile)[0] END;
     DELETE verification_request WHERE ownerId = $id;
     DELETE FROM lead WHERE id = $id;
     IF $ld != NONE {
       FOR $cid IN $ld.channels { DELETE $cid; };
     };
     IF $prof != NONE {
       FOR $rid IN $prof.recovery_channels { DELETE $rid; };
     };
     IF $ld != NONE AND $ld.profile != NONE {
       DELETE $ld.profile;
     };`,
    { id: rid(leadId) },
  );
}

export async function associateLeadWithCompanySystem(data: {
  leadId: string;
  companyId: string;
  systemId: string;
  ownerId?: string;
}): Promise<LeadCompanySystem> {
  const db = await getDb();
  const leadId = requireRecordId(data.leadId, "leadId");
  const companyId = requireRecordId(data.companyId, "companyId");
  const systemId = requireRecordId(data.systemId, "systemId");
  const result = await db.query<[LeadCompanySystem[]]>(
    `CREATE lead_company_system SET
      leadId = $leadId,
      companyId = $companyId,
      systemId = $systemId,
      ownerId = $ownerId`,
    {
      leadId: rid(leadId),
      companyId: rid(companyId),
      systemId: rid(systemId),
      ownerId: data.ownerId
        ? rid(requireRecordId(data.ownerId, "ownerId"))
        : undefined,
    },
  );
  await syncLeadCompanyIds(leadId);
  return result[0][0];
}

export async function isLeadAssociated(
  leadId: string,
  companyId: string,
  systemId: string,
): Promise<boolean> {
  const db = await getDb();
  const normalizedLeadId = requireRecordId(leadId, "leadId");
  const normalizedCompanyId = requireRecordId(companyId, "companyId");
  const normalizedSystemId = requireRecordId(systemId, "systemId");
  const result = await db.query<[{ count: number }[]]>(
    `SELECT count() AS count FROM lead_company_system
     WHERE leadId = $leadId AND companyId = $companyId AND systemId = $systemId
     GROUP ALL`,
    {
      leadId: rid(normalizedLeadId),
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
    },
  );
  return (result[0]?.[0]?.count ?? 0) > 0;
}

export async function updateLeadOwner(
  leadId: string,
  companyId: string,
  systemId: string,
  ownerId: string | null,
): Promise<void> {
  const db = await getDb();
  const normalizedLeadId = requireRecordId(leadId, "leadId");
  const normalizedCompanyId = requireRecordId(companyId, "companyId");
  const normalizedSystemId = requireRecordId(systemId, "systemId");
  await db.query(
    `UPDATE lead_company_system
     SET ownerId = $ownerId
     WHERE leadId = $leadId AND companyId = $companyId AND systemId = $systemId`,
    {
      leadId: rid(normalizedLeadId),
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
      ownerId: ownerId ? rid(requireRecordId(ownerId, "ownerId")) : undefined,
    },
  );
}

export async function removeLeadFromCompanySystem(
  leadId: string,
  companyId: string,
  systemId: string,
): Promise<void> {
  const db = await getDb();
  const normalizedLeadId = requireRecordId(leadId, "leadId");
  const normalizedCompanyId = requireRecordId(companyId, "companyId");
  const normalizedSystemId = requireRecordId(systemId, "systemId");
  await db.query(
    `DELETE FROM lead_company_system
     WHERE leadId = $leadId AND companyId = $companyId AND systemId = $systemId`,
    {
      leadId: rid(normalizedLeadId),
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
    },
  );
  const remaining = await syncLeadCompanyIds(normalizedLeadId);
  if (remaining.length === 0) {
    await runLifecycleHooks("lead:delete", { leadId: normalizedLeadId });
  }
}

export async function searchUsersInCompanySystem(
  companyId: string,
  systemId: string,
  search: string,
): Promise<{ id: string; label: string }[]> {
  const db = await getDb();
  const normalizedCompanyId = requireRecordId(companyId, "companyId");
  const normalizedSystemId = requireRecordId(systemId, "systemId");
  const result = await db.query<[Record<string, unknown>[]]>(
    `SELECT userId AS userId
     FROM user_company_system
     WHERE companyId = $companyId
       AND systemId = $systemId
     LIMIT 100 FETCH userId, userId.profile`,
    {
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
    },
  );
  const rows = result[0] ?? [];
  return rows
    .filter((row) => {
      const user = row.userId as Record<string, unknown> | undefined;
      const profile = user?.profile as Record<string, unknown> | undefined;
      const name = (profile?.name as string) ?? "";
      return name.toLowerCase().includes(search.toLowerCase());
    })
    .slice(0, 20)
    .map((row) => {
      const user = row.userId as Record<string, unknown>;
      const profile = user.profile as Record<string, unknown>;
      return { id: user.id as string, label: (profile.name as string) ?? "" };
    });
}
