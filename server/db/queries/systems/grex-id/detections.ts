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
  faceId?: string;
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
  faceId?: string;
  score: number;
}): Promise<Detection> {
  const db = await getDb();
  const leadId = data.leadId ? normalizeRecordId(data.leadId) : null;
  const faceId = data.faceId ? normalizeRecordId(data.faceId) : null;
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
  if (faceId) {
    sets.push("faceId = $faceId");
    bindings.faceId = rid(faceId);
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
  faceId?:
    | (Record<string, unknown> & { id: unknown })
    | null;
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
    `SELECT * FROM grexid_detection ${whereClause} ORDER BY detectedAt DESC LIMIT $limit FETCH locationId, faceId, leadId, leadId.profile`;

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
    const faceRecordId = row.faceId && typeof row.faceId === "object"
      ? normalizeRecordId(row.faceId.id)
      : undefined;

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
      leadId: isMember ? leadRecordId ?? undefined : undefined,
      faceId: faceRecordId ?? undefined,
      leadName: leadRecordId ? lead?.name ?? undefined : undefined,
      leadAvatarUri: leadRecordId
        ? lead?.profile?.avatarUri ?? undefined
        : undefined,
      leadEmail: isMember ? lead?.email ?? undefined : undefined,
      leadPhone: isMember ? lead?.phone ?? undefined : undefined,
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

export interface DetectionIndividual {
  faceId: string;
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  classification: "member" | "visitor" | "unknown";
  detectionCount: number;
  lastDetectedAt: string;
  bestScore: number;
  locationId: string;
  locationName: string;
  ownerId?: string;
  ownerName?: string;
}

export interface DetectionStats {
  uniqueMembers: number;
  uniqueVisitors: number;
  uniqueUnknowns: number;
  individuals: DetectionIndividual[];
  // Hour/day aggregates based on unique individuals
  hourlyUnique: number[];
  dailyUnique: number[];
}

export async function getDetectionStats(params: {
  companyId: string;
  systemId: string;
  startDate: string;
  endDate: string;
  locationId?: string;
}): Promise<DetectionStats> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {
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

  const result = await db.query<[RawDetectionRow[]]>(
    `SELECT * FROM grexid_detection ${whereClause}
     ORDER BY detectedAt DESC
     FETCH locationId, faceId, leadId, leadId.profile`,
    bindings,
  );

  const rows = result[0] ?? [];

  // Group by faceId to get unique individuals
  const faceMap = new Map<
    string,
    {
      leadId?: string;
      lead?: RawDetectionRow["leadId"];
      locationId: string;
      locationName: string;
      detectionCount: number;
      lastDetectedAt: string;
      bestScore: number;
      detections: { detectedAt: string }[];
    }
  >();

  for (const row of rows) {
    const faceRecordId = row.faceId && typeof row.faceId === "object"
      ? normalizeRecordId(row.faceId.id)
      : null;
    if (!faceRecordId) continue;

    const locId = normalizeRecordId(row.locationId.id) ?? String(row.locationId.id);
    const lead = row.leadId && typeof row.leadId === "object" ? row.leadId : null;
    const leadRecordId = normalizeRecordId(lead?.id);

    const existing = faceMap.get(faceRecordId);
    if (existing) {
      existing.detectionCount++;
      if (row.detectedAt > existing.lastDetectedAt) {
        existing.lastDetectedAt = row.detectedAt;
      }
      if (row.score > existing.bestScore) {
        existing.bestScore = row.score;
      }
      existing.detections.push({ detectedAt: row.detectedAt });
    } else {
      faceMap.set(faceRecordId, {
        leadId: leadRecordId ?? undefined,
        lead,
        locationId: locId,
        locationName: row.locationId.name,
        detectionCount: 1,
        lastDetectedAt: row.detectedAt,
        bestScore: row.score,
        detections: [{ detectedAt: row.detectedAt }],
      });
    }
  }

  // Batch-check lead_company_system for classification
  const leadIds = [
    ...new Set(
      [...faceMap.values()]
        .map((f) => f.leadId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const assocMap = new Map<string, { ownerId?: string; ownerName?: string }>();
  if (leadIds.length > 0) {
    const assocResult = await db.query<
      [{ leadId: unknown; ownerId: Record<string, unknown> | null }[]]
    >(
      `SELECT leadId, ownerId FROM lead_company_system
       WHERE leadId IN $leadIds
         AND companyId = $companyId
         AND systemId = $systemId
       FETCH ownerId, ownerId.profile`,
      {
        leadIds: leadIds.map((id) => rid(id)),
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
        ownerName: (owner as { profile?: { name?: string } })?.profile?.name
          ?? undefined,
      });
    }
  }

  // Build individuals and count unique per classification
  let uniqueMembers = 0;
  let uniqueVisitors = 0;
  let uniqueUnknowns = 0;
  const hourlyUnique = new Array(24).fill(0);
  const dailyUnique = new Array(7).fill(0);

  const individuals: DetectionIndividual[] = [];

  // Track which faces contributed to each hour/day to count unique per slot
  const hourlyFaceSet = Array.from({ length: 24 }, () => new Set<string>());
  const dailyFaceSet = Array.from({ length: 7 }, () => new Set<string>());

  for (const [faceRecordId, data] of faceMap) {
    let classification: "member" | "visitor" | "unknown" = "unknown";
    const assoc = data.leadId ? assocMap.get(data.leadId) : undefined;

    if (data.leadId) {
      classification = assoc ? "member" : "visitor";
    }

    if (classification === "member") uniqueMembers++;
    else if (classification === "visitor") uniqueVisitors++;
    else uniqueUnknowns++;

    const isMember = classification === "member";

    individuals.push({
      faceId: faceRecordId,
      leadId: isMember ? data.leadId : undefined,
      leadName: data.leadId
        ? (data.lead as Record<string, unknown>)?.name as string ?? undefined
        : undefined,
      leadAvatarUri: data.leadId
        ? ((data.lead as Record<string, unknown>)?.profile as { avatarUri?: string })
            ?.avatarUri ?? undefined
        : undefined,
      leadEmail: isMember
        ? (data.lead as Record<string, unknown>)?.email as string ?? undefined
        : undefined,
      leadPhone: isMember
        ? (data.lead as Record<string, unknown>)?.phone as string ?? undefined
        : undefined,
      classification,
      detectionCount: data.detectionCount,
      lastDetectedAt: data.lastDetectedAt,
      bestScore: data.bestScore,
      locationId: data.locationId,
      locationName: data.locationName,
      ownerId: isMember ? assoc?.ownerId : undefined,
      ownerName: isMember ? assoc?.ownerName : undefined,
    });

    // Count unique faces per hour/day
    for (const det of data.detections) {
      try {
        const date = new Date(det.detectedAt);
        const hour = date.getHours();
        const day = date.getDay();
        if (!hourlyFaceSet[hour].has(faceRecordId)) {
          hourlyFaceSet[hour].add(faceRecordId);
          hourlyUnique[hour]++;
        }
        if (!dailyFaceSet[day].has(faceRecordId)) {
          dailyFaceSet[day].add(faceRecordId);
          dailyUnique[day]++;
        }
      } catch {
        // skip invalid
      }
    }
  }

  // Sort by lastDetectedAt descending
  individuals.sort(
    (a, b) => new Date(b.lastDetectedAt).getTime() - new Date(a.lastDetectedAt).getTime(),
  );

  return {
    uniqueMembers,
    uniqueVisitors,
    uniqueUnknowns,
    individuals,
    hourlyUnique,
    dailyUnique,
  };
}
