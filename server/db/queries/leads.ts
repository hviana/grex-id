import "server-only";

import {
  getDb,
  normalizeRecordId,
  normalizeRecordIds,
  rid,
  setsToArrays,
} from "../connection.ts";
import type { Lead } from "@/src/contracts/lead";
import { runLifecycleHooks } from "@/server/module-registry";
import { genericGetById } from "@/server/db/queries/generics";

export const LEAD_OWNER_CASCADE = [
  {
    table: "profile",
    sourceField: "profileId",
    select: "id, name, avatarUri",
  },
  {
    table: "entity_channel",
    sourceField: "channelIds",
    isArray: true,
    select: "id, type, value, verified",
  },
  {
    table: "user",
    sourceField: "ownerIds",
    isArray: true,
    select: "id, profileId",
    children: [
      { table: "profile", sourceField: "profileId", select: "id, name" },
    ],
  },
];

export function hydrateLeadFromCascade(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!raw) return null;
  const c = raw._cascade as Record<string, unknown> | undefined;
  if (!c) return raw;
  const { _cascade, ...rest } = raw;
  const resolvedOwners = (c.ownerIds as Record<string, unknown>[]) ?? [];
  return {
    ...rest,
    profileId: c.profileId ?? rest.profileId,
    channelIds: c.channelIds ?? rest.channelIds,
    ownerIds: resolvedOwners.length > 0
      ? resolvedOwners.map((u: Record<string, unknown>) => ({
        id: u.id as string,
        name: ((u._cascade as Record<string, unknown>)
          ?.profileId as Record<string, unknown>)?.name as string ??
          (u.id as string),
      }))
      : rest.ownerIds,
  };
}

export async function getLeadHydrated(
  id: string,
  tenant: { companyId: string; systemId: string },
): Promise<Record<string, unknown> | null> {
  const raw = await genericGetById<Lead>(
    {
      table: "lead",
      select:
        "id, name, profileId, channelIds, tenantIds, ownerIds, tagIds, acceptsCommunication, createdAt, updatedAt",
      tenant,
      cascade: LEAD_OWNER_CASCADE,
    },
    id,
  );
  return hydrateLeadFromCascade(raw as Record<string, unknown> | null);
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

function normalizeLead<T extends Partial<Lead>>(lead: T | null): T | null {
  if (!lead) return lead;

  const normalizedId = normalizeRecordId((lead as { id?: unknown }).id);

  return {
    ...lead,
    ...(normalizedId ? { id: normalizedId } : {}),
    tenantIds: normalizeRecordIds(
      (() => {
        const raw = (lead as { tenantIds?: unknown }).tenantIds;
        if (raw instanceof Set) return [...raw] as string[];
        if (Array.isArray(raw)) return raw as string[];
        return [];
      })(),
    ),
    channelIds: normalizeRecordIds(
      (() => {
        const raw = (lead as { channelIds?: unknown }).channelIds;
        if (raw instanceof Set) return [...raw] as string[];
        if (Array.isArray(raw)) return raw as string[];
        return [];
      })(),
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
  const arr = tenantIds instanceof Set
    ? [...tenantIds]
    : Array.isArray(tenantIds)
    ? tenantIds
    : [];
  return normalizeRecordIds(arr);
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
  ownerIds?: string[];
  acceptsCommunication?: boolean;
  verified?: boolean;
}): Promise<Lead> {
  const db = await getDb();
  const tenantIdStrs = normalizeRecordIds(data.tenantIds ?? []);

  const verified = data.verified === true;

  const channelStmts = data.channels
    .map(
      (_, i) => `
      LET $ch${i} = CREATE entity_channel SET
        type = $ctype${i},
        value = $cvalue${i},
        verified = $verified;`,
    )
    .join("");

  const channelsArray = data.channels.length > 0
    ? data.channels.map((_, i) => `$ch${i}[0].id`).join(", ") + ","
    : "";

  const bindings: Record<string, unknown> = {
    profileName: data.profile.name,
    name: data.name,
    tenantIds: tenantIdStrs.map((id) => rid(requireRecordId(id, "tenantId"))),
    tagIds: (data.tags ?? []).map((tag) => typeof tag === "string" ? tag : tag),
    ownerIds: (data.ownerIds ?? []).map((ownerId) =>
      rid(requireRecordId(ownerId, "ownerId"))
    ),
    acceptsCommunication: data.acceptsCommunication === true,
    verified,
  };
  const profileSets = ["name = $profileName"];
  if (data.profile.avatarUri) {
    bindings.avatarUri = data.profile.avatarUri;
    profileSets.push("avatarUri = $avatarUri");
  }
  if (data.profile.dateOfBirth) {
    bindings.dateOfBirth = data.profile.dateOfBirth;
    profileSets.push("dateOfBirth = <datetime>$dateOfBirth");
  }
  data.channels.forEach((c, i) => {
    bindings[`ctype${i}`] = c.type;
    bindings[`cvalue${i}`] = c.value;
  });

  const tenantExpr = tenantIdStrs.length > 0
    ? tenantIdStrs.map((_, i) => `$__tid${i}`).join(", ") + ","
    : "";

  const query = `
    ${channelStmts}
    ${
    tenantIdStrs.map((_, i) => `LET $__tid${i} = $tenantIds[${i}];`).join(
      "\n    ",
    )
  }
    LET $prof = CREATE profile SET
      ${profileSets.join(",\n      ")},
      recoveryChannelIds = <set>[];
    LET $ld = CREATE lead SET
      name = $name,
      profileId = $prof[0].id,
      channelIds = ${
    data.channels.length > 0 ? `{${channelsArray}}` : "<set>[]"
  },
      tenantIds = ${tenantIdStrs.length > 0 ? `{${tenantExpr}}` : "<set>[]"},
      tagIds = <set>$tagIds,
      ownerIds = <set>$ownerIds,
      acceptsCommunication = $acceptsCommunication;
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
    ownerIds?: string[];
    acceptsCommunication?: boolean;
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
    sets.push("tagIds = <set>$tags");
    bindings.tags = data.tags;
  }
  if (data.ownerIds !== undefined) {
    sets.push("ownerIds = <set>$ownerIds");
    bindings.ownerIds = normalizeRecordIds(data.ownerIds).map((ownerId) =>
      rid(requireRecordId(ownerId, "ownerId"))
    );
  }
  if (data.acceptsCommunication !== undefined) {
    sets.push("acceptsCommunication = $acceptsCommunication");
    bindings.acceptsCommunication = data.acceptsCommunication;
  }
  if (tenantIds !== undefined) {
    sets.push("tenantIds = <set>$tenantIds");
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
      bindings.avatarUri = data.profile.avatarUri || null;
    }
    if (data.profile.dateOfBirth !== undefined) {
      profileSets.push("dateOfBirth = <datetime>$dateOfBirth");
      bindings.dateOfBirth = data.profile.dateOfBirth || null;
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
     DELETE entity_channel WHERE id IN $chIds;
     DELETE entity_channel WHERE id IN $recIds;
     IF $ld != NONE AND $ld.profileId != NONE {
       DELETE $ld.profileId;
     };`,
    { id: rid(leadId) },
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
    `UPDATE $leadId SET tenantIds -= $tenantId, updatedAt = time::now();`,
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
         ) ELSE {} END;
         LET $appended = IF array::len($new) > 0 THEN (
           UPDATE $owner SET
             channelIds += $new[0].id,
             updatedAt = time::now()
         ) ELSE {} END;
         LET $flipped = IF array::len($existing) > 0 THEN (
           UPDATE $existing[0].id SET
             verified = true,
             updatedAt = time::now()
         ) ELSE {} END;`,
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
    `SELECT actorId
     FROM tenant
     WHERE companyId = $companyId
       AND systemId = $systemId
       AND actorId != NONE
     FETCH actorId, actorId.profileId`,
    {
      companyId: rid(normalizedCompanyId),
      systemId: rid(normalizedSystemId),
    },
  );
  const rows = result[0] ?? [];
  const normalized = rows.map((row) => setsToArrays(row));
  const q = search.toLowerCase();
  return normalized
    .filter((row) => {
      const user = row.actorId as Record<string, unknown> | undefined;
      const profile = user?.profileId as Record<string, unknown> | undefined;
      const name = (profile?.name as string) ?? "";
      return name.toLowerCase().includes(q);
    })
    .slice(0, 20)
    .map((row) => {
      const user = row.actorId as Record<string, unknown>;
      const profile = user.profileId as Record<string, unknown>;
      return { id: user.id as string, label: (profile.name as string) ?? "" };
    });
}
