import { getDb, rid } from "@/server/db/connection";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();
  if (/^[^:\s]+:[^:\s]+$/.test(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string") {
      const innerId = typeof record.id === "string"
        ? record.id
        : record.id != null
        ? String((record.id as { String?: string }).String ?? record.id)
        : "";
      if (innerId) return `${record.tb}:${innerId}`;
    }
    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }
  }

  return stringified || null;
}

export interface Detection {
  id: string;
  locationId: string;
  leadId?: string;
  score: number;
  detectedAt: string;
  createdAt: string;
}

export interface DetectionReportItem {
  id: string;
  detectedAt: string;
  score: number;
  locationName: string;
  locationId: string;
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  ownerId?: string;
  ownerName?: string;
  classification: "member" | "visitor" | "unknown";
}

export async function createDetection(data: {
  locationId: string;
  leadId?: string;
  score: number;
}): Promise<Detection> {
  const db = await getDb();
  const leadId = data.leadId ? normalizeRecordId(data.leadId) : null;
  const bindings: Record<string, unknown> = {
    locationId: rid(data.locationId),
    score: data.score,
  };
  const sets = [
    "locationId = $locationId",
    "score = $score",
    "detectedAt = time::now()",
  ];
  if (leadId) {
    sets.push("leadId = $leadId");
    bindings.leadId = rid(leadId);
  }
  const result = await db.query<[Detection[]]>(
    `CREATE grexid_detection SET ${sets.join(", ")}`,
    bindings,
  );
  return result[0][0];
}

interface RawDetectionRow {
  id: unknown;
  detectedAt: string;
  score: number;
  locationId:
    & Record<string, unknown>
    & {
      id: unknown;
      name: string;
      companyId: unknown;
      systemId: unknown;
    };
  leadId?:
    | (Record<string, unknown> & {
      id: unknown;
      name?: string;
      email?: string;
      phone?: string;
      profile?: { avatarUri?: string };
    })
    | null;
}

export async function listDetections(
  params: CursorParams & {
    companyId: string;
    systemId: string;
    startDate: string;
    endDate: string;
    locationId?: string;
  },
): Promise<PaginatedResult<DetectionReportItem>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = {
    limit: limit + 1,
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    startDate: params.startDate,
    endDate: params.endDate,
  };

  let whereClause = `
    WHERE locationId.companyId = $companyId
      AND locationId.systemId = $systemId
      AND detectedAt >= type::datetime($startDate)
      AND detectedAt <= type::datetime($endDate)`;

  if (params.locationId) {
    whereClause += " AND locationId = $locationId";
    bindings.locationId = rid(params.locationId);
  }
  if (params.cursor) {
    whereClause += params.direction === "prev"
      ? " AND id < $cursor"
      : " AND id > $cursor";
    bindings.cursor = params.cursor;
  }

  const query =
    `SELECT * FROM grexid_detection ${whereClause} ORDER BY detectedAt DESC LIMIT $limit FETCH locationId, leadId, leadId.profile`;

  const result = await db.query<[RawDetectionRow[]]>(query, bindings);
  const rawItems = result[0] ?? [];
  const hasMore = rawItems.length > limit;
  const fetched = hasMore ? rawItems.slice(0, limit) : rawItems;

  // Collect unique leadIds to batch-check lead_company_system associations.
  // Only associations for the CURRENT company + system determine "member"
  // status — the authoritative multi-tenant boundary is lead_company_system,
  // not lead.companyIds.
  const leadIds = [
    ...new Set(
      fetched
        .map((r) =>
          r.leadId && typeof r.leadId === "object"
            ? normalizeRecordId((r.leadId as { id: unknown }).id)
            : null
        )
        .filter((leadId): leadId is string => Boolean(leadId)),
    ),
  ];

  const assocMap = new Map<
    string,
    { ownerId?: string; ownerName?: string }
  >();

  if (leadIds.length > 0) {
    const assocResult = await db.query<
      [
        {
          leadId: unknown;
          ownerId:
            | (Record<string, unknown> & {
              id: unknown;
              profile?: { name?: string };
            })
            | null;
        }[],
      ]
    >(
      `SELECT leadId, ownerId FROM lead_company_system
       WHERE leadId IN $leadIds
         AND companyId = $companyId
         AND systemId = $systemId
       FETCH ownerId, ownerId.profile`,
      {
        leadIds: leadIds.map((leadId) => rid(leadId)),
        companyId: rid(params.companyId),
        systemId: rid(params.systemId),
      },
    );

    for (const row of assocResult[0] ?? []) {
      const lid = normalizeRecordId(row.leadId);
      if (!lid) continue;
      const owner = row.ownerId && typeof row.ownerId === "object"
        ? row.ownerId
        : null;
      assocMap.set(lid, {
        ownerId: owner ? normalizeRecordId(owner.id) ?? undefined : undefined,
        ownerName: owner?.profile?.name ?? undefined,
      });
    }
  }

  const enriched: DetectionReportItem[] = fetched.map((row) => {
    const loc = row.locationId;
    const lead = row.leadId && typeof row.leadId === "object"
      ? row.leadId
      : null;
    const leadRecordId = normalizeRecordId(lead?.id);

    // Classification rules (multi-tenant):
    // - unknown: detection has no leadId (face did not match any registered lead)
    // - member:  lead is associated with the CURRENT company + system
    //            (has a lead_company_system row for this tenant)
    // - visitor: lead exists in the database but is NOT associated with the
    //            current company + system (it belongs to another tenant, or
    //            has no tenant at all)
    let classification: "member" | "visitor" | "unknown" = "unknown";
    const assoc = leadRecordId ? assocMap.get(leadRecordId) : undefined;

    if (leadRecordId) {
      classification = assoc ? "member" : "visitor";
    }

    const isMember = classification === "member";

    return {
      id: normalizeRecordId(row.id) ?? String(row.id),
      detectedAt: row.detectedAt,
      score: row.score,
      locationId: normalizeRecordId(loc.id) ?? String(loc.id),
      locationName: loc.name,
      // leadId is exposed only for members. For visitors we intentionally hide
      // the record id so the frontend cannot correlate visitors across tenants.
      leadId: isMember ? leadRecordId ?? undefined : undefined,
      // Name and avatar are shown for members and visitors (so the operator
      // can still recognize a recurring visitor's face), but never for unknown.
      leadName: leadRecordId ? lead?.name ?? undefined : undefined,
      leadAvatarUri: leadRecordId
        ? lead?.profile?.avatarUri ?? undefined
        : undefined,
      // Contact details are member-only. Visitors and unknown never expose
      // email/phone — that information belongs to the tenant that owns the lead.
      leadEmail: isMember ? lead?.email ?? undefined : undefined,
      leadPhone: isMember ? lead?.phone ?? undefined : undefined,
      // Owner is resolved from lead_company_system for the CURRENT tenant only,
      // so owners from other tenants are never leaked. It is only surfaced for
      // members because visitors have no association in this tenant.
      ownerId: isMember ? assoc?.ownerId : undefined,
      ownerName: isMember ? assoc?.ownerName : undefined,
      classification,
    };
  });

  return {
    data: enriched,
    nextCursor: hasMore ? enriched[enriched.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}
