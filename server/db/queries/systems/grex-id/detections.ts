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

function normalizeRecordIds(values: unknown[]): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    const id = normalizeRecordId(value);
    if (id) {
      ids.add(id);
    }
  }

  return [...ids];
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
  leadCompanyIds?: string[];
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
  const result = await db.query<[Detection[]]>(
    `CREATE grexid_detection SET
      locationId = $locationId,
      leadId = $leadId,
      score = $score,
      detectedAt = time::now()`,
    {
      locationId: rid(data.locationId),
      leadId: data.leadId ? rid(data.leadId) : undefined,
      score: data.score,
    },
  );
  return result[0][0];
}

interface RawDetectionRow {
  id: string;
  detectedAt: string;
  score: number;
  locationId: Record<string, unknown> & {
    id: string;
    name: string;
    companyId: string;
    systemId: string;
  };
  leadId?:
    | (Record<string, unknown> & {
      id: string;
      name: string;
      email: string;
      phone?: string;
      companyIds?: unknown[];
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

  // Collect unique leadIds to batch-check lead_company_system associations
  const leadIds = [
    ...new Set(
      fetched
        .filter((r) => r.leadId && typeof r.leadId === "object")
        .map((r) => normalizeRecordId((r.leadId as { id: string }).id))
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
          leadId: string;
          ownerId:
            | (Record<string, unknown> & {
              id: string;
              profile?: { name?: string };
            })
            | null;
        }[],
      ]
    >(
      `SELECT * FROM lead_company_system
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
        ownerId: owner?.id,
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
    const leadCompanyIds = normalizeRecordIds(
      Array.isArray(lead?.companyIds) ? lead.companyIds : [],
    );

    let classification: "member" | "visitor" | "unknown" = "unknown";
    let ownerId: string | undefined;
    let ownerName: string | undefined;

    if (leadRecordId) {
      const assoc = assocMap.get(leadRecordId);
      const belongsToCurrentCompany =
        leadCompanyIds.includes(params.companyId) || Boolean(assoc);

      if (belongsToCurrentCompany) {
        classification = "member";
        ownerId = assoc.ownerId;
        ownerName = assoc.ownerName;
      } else {
        classification = "visitor";
      }
    }

    return {
      id: row.id,
      detectedAt: row.detectedAt,
      score: row.score,
      locationId: loc.id,
      locationName: loc.name,
      leadId: leadRecordId,
      leadName: lead?.name,
      leadEmail: classification === "visitor" ? undefined : lead?.email,
      leadPhone: classification === "visitor" ? undefined : lead?.phone,
      leadAvatarUri: lead?.profile?.avatarUri,
      leadCompanyIds,
      ownerId,
      ownerName,
      classification,
    };
  });

  return {
    data: enriched,
    nextCursor: hasMore ? enriched[enriched.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}
