import { getDb, rid } from "../connection.ts";
import type { Lead } from "@/src/contracts/lead";
import { runLifecycleHooks } from "@/server/module-registry";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("leads");

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
    tenantIds: normalizeRecordIds(
      Array.isArray((lead as { tenantIds?: unknown[] }).tenantIds)
        ? (lead as { tenantIds?: unknown[] }).tenantIds ?? []
        : [],
    ),
  };
}

async function getLeadTenantIds(id: string): Promise<string[]> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  const result = await db.query<[{ tenantIds?: unknown[] }[]]>(
    "SELECT tenantIds FROM lead WHERE id = $id LIMIT 1",
    { id: rid(leadId) },
  );

  const tenantIds = result[0]?.[0]?.tenantIds;
  return normalizeRecordIds(Array.isArray(tenantIds) ? tenantIds : []);
}

export async function findLeadByChannelValues(
  values: string[],
): Promise<Lead | null> {
  if (values.length === 0) return null;
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $chIds = (SELECT VALUE id FROM entity_channel WHERE value IN $values);
     SELECT * FROM lead
     WHERE channelIds ANYINSIDE $chIds
     LIMIT 1 FETCH profileId, channelIds;`,
    { values },
  );
  const last = result[result.length - 1] as Lead[] | undefined;
  return normalizeLead(last?.[0] ?? null);
}

export async function createLead(data: {
  name: string;
  profile: { name: string; avatarUri?: string; dateOfBirth?: string };
  channels: { type: string; value: string }[];
  tenantIds?: string[];
  tags?: string[];
}): Promise<Lead> {
  const db = await getDb();
  const tenantIds = normalizeRecordIds(data.tenantIds ?? []).map((
    tenantId,
  ) => rid(requireRecordId(tenantId, "tenantId")));

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
    dateOfBirth: data.profile.dateOfBirth ?? undefined,
    name: data.name,
    tenantIds,
    tagIds: data.tags ?? [],
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
      dateOfBirth = $dateOfBirth,
      recoveryChannelIds = [];
    LET $ld = CREATE lead SET
      name = $name,
      profileId = $prof[0].id,
      channelIds = [${channelsArray}],
      tenantIds = $tenantIds,
      tagIds = $tags;
    SELECT * FROM $ld[0].id FETCH profileId, channelIds;`;

  const result = await db.query<unknown[]>(query, bindings);
  const last = result[result.length - 1] as Lead[];
  return normalizeLead(last[0])!;
}

export async function updateLead(
  id: string,
  data: {
    name?: string;
    profile?: { name?: string; avatarUri?: string; dateOfBirth?: string };
    tenantIds?: string[];
    tags?: string[];
  },
): Promise<Lead> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  const tenantIds = data.tenantIds !== undefined
    ? normalizeRecordIds(data.tenantIds).map((tenantId) =>
      requireRecordId(tenantId, "tenantId")
    )
    : undefined;
  const sets: string[] = ["updatedAt = time::now()"];
  const bindings: Record<string, unknown> = { id: rid(leadId) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.tags !== undefined) {
    sets.push("tagIds = $tags");
    bindings.tags = data.tags;
  }
  if (tenantIds !== undefined) {
    sets.push("tenantIds = $tenantIds");
    bindings.tenantIds = tenantIds.map((tenantId) => rid(tenantId));
  }

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
    if (data.profile.dateOfBirth !== undefined) {
      profileSets.push("dateOfBirth = $dateOfBirth");
      bindings.dateOfBirth = data.profile.dateOfBirth
        ? `<datetime>${data.profile.dateOfBirth}`
        : undefined;
    }
    statements.push(
      `LET $ld = (SELECT profileId FROM $id);
      IF $ld[0].profileId != NONE {
        UPDATE $ld[0].profileId SET ${profileSets.join(", ")};
      }`,
    );
  }

  statements.push(`UPDATE $id SET ${sets.join(", ")}`);
  statements.push("SELECT * FROM $id FETCH profileId, channelIds");

  const results = await db.query<unknown[]>(
    statements.join(";\n") + ";",
    bindings,
  );
  const selectResult = results[results.length - 1] as Lead[];
  return normalizeLead(selectResult[0])!;
}

export async function deleteLead(id: string): Promise<void> {
  const db = await getDb();
  const leadId = requireRecordId(id, "leadId");
  await runLifecycleHooks("lead:delete", { leadId });
  await db.query(
    `LET $ld    = (SELECT profileId, channelIds FROM lead WHERE id = $id)[0];
     LET $chIds = IF $ld = NONE THEN [] ELSE $ld.channelIds END;
     LET $prof  = IF $ld = NONE OR $ld.profileId = NONE
                  THEN NONE
                  ELSE (SELECT recoveryChannelIds FROM $ld.profileId)[0]
                  END;
     LET $recIds = IF $prof = NONE THEN [] ELSE $prof.recoveryChannelIds END;
     DELETE verification_request WHERE ownerId = $id;
     DELETE FROM lead WHERE id = $id;
     FOR $cid IN $chIds { DELETE $cid; };
     FOR $rid IN $recIds { DELETE $rid; };
     IF $ld != NONE AND $ld.profileId != NONE {
       DELETE $ld.profileId;
     };`,
    { id: rid(leadId) },
  );
}

export async function associateLeadWithTenant(data: {
  leadId: string;
  tenantId: string;
}): Promise<void> {
  const db = await getDb();
  const leadId = requireRecordId(data.leadId, "leadId");
  const tenantId = requireRecordId(data.tenantId, "tenantId");
  await db.query(
    `UPDATE $leadId SET tenantIds += $tenantId, updatedAt = time::now();`,
    {
      leadId: rid(leadId),
      tenantId: rid(tenantId),
    },
  );
}

export async function removeLeadFromTenant(
  leadId: string,
  tenantId: string,
): Promise<void> {
  const db = await getDb();
  const normalizedLeadId = requireRecordId(leadId, "leadId");
  const normalizedTenantId = requireRecordId(tenantId, "tenantId");
  await db.query(
    `UPDATE $leadId SET tenantIds = tenantIds[WHERE $this != $tenantId], updatedAt = time::now();`,
    {
      leadId: rid(normalizedLeadId),
      tenantId: rid(normalizedTenantId),
    },
  );
  // If lead has no remaining tenant associations, delete it
  const remaining = await getLeadTenantIds(normalizedLeadId);
  if (remaining.length === 0) {
    await deleteLead(normalizedLeadId);
  }
}

/**
 * Sync a lead's channels for the lead-update verification flow.
 */
export async function syncLeadChannels(
  leadId: string,
  channels: { type: string; value: string }[],
): Promise<void> {
  const db = await getDb();
  for (const ch of channels) {
    await db.query(
      `LET $lead = (SELECT channelIds FROM lead WHERE id = $owner)[0];
         LET $ids  = IF $lead = NONE THEN [] ELSE $lead.channelIds END;
         LET $existing = (SELECT id FROM entity_channel
           WHERE id IN $ids AND type = $type AND value = $value
           LIMIT 1);
         LET $new = IF $lead != NONE AND array::len($existing) = 0 THEN (
           CREATE entity_channel SET
             type = $type, value = $value, verified = true
         ) ELSE [] END;
         LET $appended = IF array::len($new) > 0 THEN (
           UPDATE $owner SET
             channelIds += $new[0].id,
             updatedAt = time::now()
         ) ELSE [] END;
         LET $flipped = IF array::len($existing) > 0 THEN (
           UPDATE $existing[0].id SET
             verified = true,
             updatedAt = time::now()
         ) ELSE [] END;`,
      {
        owner: rid(leadId),
        type: ch.type,
        value: ch.value,
      },
    );
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
    `SELECT actorId AS userId
     FROM tenant
     WHERE companyId = $companyId
       AND systemId = $systemId
       AND actorId != NONE
     LIMIT 100 FETCH actorId, actorId.profileId`,
    {
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
    },
  );
  const rows = result[0] ?? [];
  return rows
    .filter((row) => {
      const user = row.userId as Record<string, unknown> | undefined;
      const profile = user?.profileId as Record<string, unknown> | undefined;
      const name = (profile?.name as string) ?? "";
      return name.toLowerCase().includes(search.toLowerCase());
    })
    .slice(0, 20)
    .map((row) => {
      const user = row.userId as Record<string, unknown>;
      const profile = user.profileId as Record<string, unknown>;
      return { id: user.id as string, label: (profile.name as string) ?? "" };
    });
}
