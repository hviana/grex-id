import "server-only";
import {
  getDb,
  normalizeRecordId,
  rid,
  setsToArrays,
} from "@/server/db/connection";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import { clampPageLimit } from "@/src/lib/validators";
import type { GrexidDetection as Detection } from "@systems/grex-id/src/contracts/grexid-detection";
import type {
  AggregatedFaceRow,
  DetectionIndividual,
  DetectionReportItem,
  DetectionStats,
  FaceMatchResult,
  HourlyBucket,
  RawDetectionRow,
} from "@systems/grex-id/src/contracts/high-level/detection";

export async function createDetection(data: {
  locationId: string;
  leadId?: string;
  faceId?: string;
  score: number;
  eventId?: string;
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
  if (data.eventId) {
    sets.push("eventId = $eventId");
    bindings.eventId = data.eventId;
  }
  const result = await db.query<[Detection[]]>(
    `CREATE grexid_detection SET ${sets.join(", ")}`,
    bindings,
  );
  return result[0][0];
}

export async function listDetections(
  params: CursorParams & {
    companyId: string;
    systemId: string;
    startDate: string;
    endDate: string;
    locationId?: string;
    tagIds?: string[];
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
    tagIds: params.tagIds ?? [],
  };

  let tagFilter = "";
  if (params.tagIds && params.tagIds.length > 0) {
    tagFilter = " AND leadId.tagIds CONTAINSALL $tagIds";
  }

  let locationFilter = "";
  if (params.locationId) {
    locationFilter = " AND locationId = $locationId";
    bindings.locationId = rid(params.locationId);
  }

  let cursorFilter = "";
  if (params.cursor) {
    cursorFilter = " AND faceId > $cursor";
    bindings.cursor = params.cursor;
  }

  // Single batched query:
  //  1) Per-face aggregation via GROUP BY with cursor pagination on faceId
  //  2) Lead membership + full data for LeadView
  const query =
    `LET $sysTenantId = (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId AND !actorId LIMIT 1)[0];

    SELECT
        faceId,
        array::distinct(leadId)[0] AS leadId,
        array::distinct(locationId)[0] AS locationId,
        count() AS detectionCount,
        math::max(score) AS bestScore,
        time::max(detectedAt) AS lastDetectedAt
      FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDate)${tagFilter}${locationFilter}${cursorFilter}
      GROUP BY faceId
      ORDER BY faceId
      LIMIT $limit
      FETCH faceId, leadId, leadId.profileId, locationId;

    LET $leadIds = (SELECT VALUE leadId
        FROM grexid_detection
        WHERE locationId.tenantIds CONTAINS $sysTenantId
          AND detectedAt >= type::datetime($startDate)
          AND detectedAt <= type::datetime($endDate)${tagFilter}${locationFilter}${cursorFilter}
          AND leadId
        GROUP BY leadId);

    SELECT id AS leadId, acceptsCommunication, tagIds,
      (SELECT id, type, \`value\`, verified, createdAt, updatedAt FROM entity_channel WHERE id IN $parent.channelIds) AS channelIds,
      (SELECT id, profileId.name AS name FROM user WHERE id IN $parent.ownerIds) AS ownerIds,
      createdAt, profileId FROM lead
      WHERE id IN $leadIds
        AND tenantIds CONTAINS $sysTenantId;`;

  type LeadAssocRow = {
    leadId: unknown;
    acceptsCommunication: boolean;
    tagIds: unknown[];
    channelIds: {
      id: unknown;
      type: string;
      value: string;
      verified: boolean;
      createdAt: string;
      updatedAt: string;
    }[];
    ownerIds: { id: unknown; name?: string }[];
    createdAt: string;
    profileId?: {
      id: unknown;
      name?: string;
      avatarUri?: string;
    };
  };

  const result = await db.query<
    [unknown, AggregatedFaceRow[], unknown, LeadAssocRow[]]
  >(query, bindings);
  const aggregatedFaces = result[1] ?? [];
  const assocRows = result[3] ?? [];
  const hasMore = aggregatedFaces.length > limit;
  const fetched = hasMore ? aggregatedFaces.slice(0, limit) : aggregatedFaces;

  const assocMap = new Map<
    string,
    {
      ownerIds: { id: string; name: string }[];
      acceptsCommunication: boolean;
      tagIds: string[];
      channelIds: {
        id: string;
        type: string;
        value: string;
        verified: boolean;
        createdAt: string;
        updatedAt: string;
      }[];
      profileId?: { name?: string; avatarUri?: string };
      createdAt: string;
    }
  >();

  for (const raw of assocRows) {
    const row = setsToArrays(raw) as typeof raw;
    const lid = normalizeRecordId(row.leadId);
    if (!lid) continue;
    const owners: { id: string; name: string }[] = Array.isArray(row.ownerIds)
      ? (row.ownerIds as Record<string, unknown>[])
        .map((o) => {
          const oid = normalizeRecordId(o.id);
          if (!oid) return null;
          return { id: oid, name: String(o.name ?? oid) };
        })
        .filter((o): o is { id: string; name: string } => o !== null)
      : [];
    const profile = row.profileId && typeof row.profileId === "object"
      ? row.profileId
      : null;
    assocMap.set(lid, {
      ownerIds: owners,
      acceptsCommunication: row.acceptsCommunication !== false,
      tagIds: (Array.isArray(row.tagIds) ? row.tagIds : [])
        .map((t) => typeof t === "string" ? t : "")
        .filter(Boolean),
      channelIds: Array.isArray(row.channelIds)
        ? (row.channelIds as Record<string, unknown>[])
          .map((ch) => ({
            id: normalizeRecordId(ch.id) ?? String(ch.id ?? ""),
            type: String(ch.type ?? ""),
            value: String(ch.value ?? ""),
            verified: Boolean(ch.verified),
            createdAt: String(ch.createdAt ?? ""),
            updatedAt: String(ch.updatedAt ?? ""),
          }))
        : [],
      profileId: profile?.name
        ? { name: profile.name, avatarUri: profile.avatarUri }
        : undefined,
      createdAt: row.createdAt ?? "",
    });
  }

  const enriched: DetectionReportItem[] = fetched.map((faceRow) => {
    const faceRecordId = normalizeRecordId(faceRow.faceId?.id);
    const lead = faceRow.leadId && typeof faceRow.leadId === "object"
      ? faceRow.leadId
      : null;
    const leadRecordId = normalizeRecordId(lead?.id);
    const loc = faceRow.locationId;

    let classification: "member" | "visitor" | "unknown" | "suppressed" =
      "unknown";
    const assoc = leadRecordId ? assocMap.get(leadRecordId) : undefined;

    if (leadRecordId && assoc) {
      classification = assoc.acceptsCommunication ? "member" : "suppressed";
    } else if (leadRecordId) {
      classification = "visitor";
    }

    const isMember = classification === "member" ||
      classification === "suppressed";

    const base: DetectionReportItem = {
      id: isMember
        ? (leadRecordId ?? faceRecordId ?? "")
        : classification === "unknown"
        ? (faceRecordId ?? "")
        : (normalizeRecordId(faceRow.faceId?.id) ?? ""),
      detectedAt: faceRow.lastDetectedAt,
      score: faceRow.bestScore,
      locationId: normalizeRecordId(loc?.id) ?? String(loc?.id ?? ""),
      locationName: loc?.name ?? "",
      leadId: isMember ? leadRecordId ?? undefined : undefined,
      faceId: faceRecordId ?? undefined,
      classification,
      name: undefined,
      profileId: undefined,
      channelIds: undefined,
      tagIds: undefined,
      ownerIds: undefined,
      interactions: undefined,
      acceptsCommunication: true,
      createdAt: "",
    };

    if (isMember && assoc) {
      base.name = lead?.name ?? undefined;
      base.profileId = assoc.profileId?.name
        ? { name: assoc.profileId.name, avatarUri: assoc.profileId.avatarUri }
        : undefined;
      base.channelIds = assoc.channelIds.length > 0
        ? assoc.channelIds
        : undefined;
      base.tagIds = assoc.tagIds.length > 0 ? assoc.tagIds : undefined;
      base.ownerIds = assoc.ownerIds.length > 0 ? assoc.ownerIds : undefined;
      base.interactions = faceRow.detectionCount;
      base.acceptsCommunication = assoc.acceptsCommunication;
      base.createdAt = assoc.createdAt;
    } else if (classification === "visitor") {
      base.name = lead?.name ?? undefined;
      base.profileId = lead?.profileId?.name
        ? {
          name: lead.profileId.name,
          avatarUri: lead.profileId.avatarUri,
        }
        : undefined;
      base.interactions = faceRow.detectionCount;
    } else if (classification === "unknown") {
      base.interactions = faceRow.detectionCount;
    }

    return base;
  });

  return {
    items: enriched,
    total: enriched.length,
    hasMore,
    nextCursor: hasMore
      ? enriched[enriched.length - 1]?.faceId ?? undefined
      : undefined,
  };
}

export async function getDetectionStats(params: {
  companyId: string;
  systemId: string;
  startDate: string;
  endDate: string;
  locationId?: string;
  tagIds?: string[];
}): Promise<DetectionStats> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    startDate: params.startDate,
    endDate: params.endDate,
    endDateInclusive: `${params.endDate}T23:59:59Z`,
    tagIds: params.tagIds ?? [],
  };

  let locationFilter = "";
  if (params.locationId) {
    locationFilter = " AND locationId = $locationId";
    bindings.locationId = rid(params.locationId);
  }

  let tagFilter = "";
  if (params.tagIds && params.tagIds.length > 0) {
    tagFilter = " AND leadId.tagIds CONTAINSALL $tagIds";
  }

  // Single batched query:
  //  1) Per-face aggregation via GROUP BY
  //  2) Raw detections for hourly bucketing
  //  3) lead membership check with acceptsCommunication for classification
  const result = await db.query<
    [
      unknown,
      AggregatedFaceRow[],
      { faceId: unknown; detectedAt: string }[],
      unknown,
      {
        leadId: unknown;
        acceptsCommunication: boolean;
        ownerIds: { id: unknown; name?: string }[];
      }[],
    ]
  >(
    `LET $sysTenantId = (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId AND !actorId LIMIT 1)[0];

    SELECT
        faceId,
        array::distinct(leadId)[0] AS leadId,
        array::distinct(locationId)[0] AS locationId,
        count() AS detectionCount,
        math::max(score) AS bestScore,
        time::max(detectedAt) AS lastDetectedAt
      FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDateInclusive)${tagFilter}${locationFilter}
      GROUP BY faceId
      ORDER BY lastDetectedAt DESC
      FETCH faceId, leadId, leadId.profileId, locationId;

    SELECT faceId, detectedAt FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDateInclusive)${tagFilter}${locationFilter};

    LET $leadIds = (SELECT VALUE leadId
        FROM grexid_detection
        WHERE locationId.tenantIds CONTAINS $sysTenantId
          AND detectedAt >= type::datetime($startDate)
          AND detectedAt <= type::datetime($endDateInclusive)${tagFilter}${locationFilter}
          AND leadId
        GROUP BY leadId);

    SELECT id AS leadId, acceptsCommunication,
      (SELECT id, profileId.name AS name FROM user WHERE id IN $parent.ownerIds) AS ownerIds
    FROM lead
      WHERE id IN $leadIds
        AND tenantIds CONTAINS $sysTenantId;`,
    bindings,
  );

  const aggregatedFaces = result[1] ?? [];
  const rawDetections = result[2] ?? [];
  const assocRows = result[4] ?? [];

  // Build membership lookup map
  const assocMap = new Map<
    string,
    { ownerIds: { id: string; name: string }[]; acceptsCommunication: boolean }
  >();
  for (const raw of assocRows) {
    const row = setsToArrays(raw) as typeof raw;
    const lid = normalizeRecordId(row.leadId);
    if (!lid) continue;
    const owners: { id: string; name: string }[] = Array.isArray(row.ownerIds)
      ? (row.ownerIds as Record<string, unknown>[])
        .map((o) => {
          const oid = normalizeRecordId(o.id);
          if (!oid) return null;
          return { id: oid, name: String(o.name ?? oid) };
        })
        .filter((o): o is { id: string; name: string } => o !== null)
      : [];
    assocMap.set(lid, {
      ownerIds: owners,
      acceptsCommunication: row.acceptsCommunication !== false,
    });
  }

  // Build individuals and faceClassificationMap
  let uniqueMembers = 0;
  let uniqueVisitors = 0;
  let uniqueUnknowns = 0;
  let uniqueSuppressed = 0;
  const individuals: DetectionIndividual[] = [];
  const faceClassificationMap = new Map<
    string,
    "member" | "visitor" | "unknown" | "suppressed"
  >();

  for (const faceRow of aggregatedFaces) {
    const faceRecordId = normalizeRecordId(faceRow.faceId?.id);
    if (!faceRecordId) continue;

    const lead = faceRow.leadId && typeof faceRow.leadId === "object"
      ? faceRow.leadId
      : null;
    const leadRecordId = normalizeRecordId(lead?.id);

    let classification: "member" | "visitor" | "unknown" | "suppressed" =
      "unknown";
    const assoc = leadRecordId ? assocMap.get(leadRecordId) : undefined;
    if (leadRecordId && assoc) {
      classification = assoc.acceptsCommunication ? "member" : "suppressed";
    } else if (leadRecordId) {
      classification = "visitor";
    }

    if (classification === "member") uniqueMembers++;
    else if (classification === "suppressed") uniqueSuppressed++;
    else if (classification === "visitor") uniqueVisitors++;
    else uniqueUnknowns++;

    faceClassificationMap.set(faceRecordId, classification);

    const isMember = classification === "member" ||
      classification === "suppressed";

    individuals.push({
      faceId: faceRecordId,
      leadId: isMember ? leadRecordId ?? undefined : undefined,
      leadName: leadRecordId ? lead?.name ?? undefined : undefined,
      leadAvatarUri: leadRecordId
        ? lead?.profileId?.avatarUri ?? undefined
        : undefined,
      leadEmail: isMember ? lead?.email ?? undefined : undefined,
      leadPhone: isMember ? lead?.phone ?? undefined : undefined,
      classification,
      detectionCount: faceRow.detectionCount,
      lastDetectedAt: faceRow.lastDetectedAt,
      bestScore: faceRow.bestScore,
      locationId: normalizeRecordId(faceRow.locationId?.id) ??
        String(faceRow.locationId?.id ?? ""),
      locationName: faceRow.locationId?.name ?? "",
      ownerId: isMember ? assoc?.ownerIds[0]?.id : undefined,
      ownerName: isMember ? assoc?.ownerIds[0]?.name : undefined,
    });
  }

  // Build hourly buckets from raw detections
  const hourlyBuckets: HourlyBucket[] = Array.from(
    { length: 24 },
    (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00` as HourlyBucket["hour"],
      unknown: 0,
      visitor: 0,
      member: 0,
      suppressed: 0,
    }),
  );

  for (const det of rawDetections) {
    const fid = normalizeRecordId(det.faceId);
    if (!fid) continue;
    const cls = faceClassificationMap.get(fid);
    if (!cls) continue;
    try {
      const date = new Date(det.detectedAt);
      const h = date.getHours();
      if (h >= 0 && h < 24) {
        hourlyBuckets[h][cls]++;
      }
    } catch {
      // skip invalid dates
    }
  }

  return {
    uniqueMembers,
    uniqueVisitors,
    uniqueUnknowns,
    uniqueSuppressed,
    individuals,
    hourlyBuckets,
  };
}

// ─── process-detection handler queries ────────────────────────────────────────

/**
 * Check idempotency: whether detections already exist for a given event.
 * Returns true if a detection already exists.
 */
export async function detectionExistsForEvent(
  locationId: string,
  eventId: string,
): Promise<boolean> {
  const db = await getDb();
  const existing = await db.query<[{ id: unknown }[]]>(
    `SELECT id FROM grexid_detection
     WHERE locationId = $locationId
       AND eventId = $eventId
     LIMIT 1`,
    { locationId: rid(locationId), eventId },
  );
  return (existing[0] ?? []).length > 0;
}

/**
 * Search for a matching face by embedding using KNN vector search.
 */
export async function searchMatchingFace(
  embedding: number[],
  index: number,
): Promise<FaceMatchResult | undefined> {
  const db = await getDb();
  const result = await db.query<[FaceMatchResult[]]>(
    `SELECT id, leadId, vector::distance::knn() AS score
     FROM face
     WHERE embedding_type1 <|1,40|> $embedding_${index}
     ORDER BY score`,
    { [`embedding_${index}`]: embedding },
  );
  return result[0]?.[0];
}

/**
 * Execute a batch of detection create statements (known faces + unknown faces).
 */
export async function batchCreateDetections(
  statements: string[],
  bindings: Record<string, unknown>,
): Promise<void> {
  if (statements.length === 0) return;
  const db = await getDb();
  await db.query(statements.join(";\n"), bindings);
}
