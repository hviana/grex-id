import { getDb, normalizeRecordId, rid } from "@/server/db/connection";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import { clampPageLimit } from "@/src/lib/validators";
import { assertServerOnly } from "@/server/utils/server-only.ts";
import type {
  AggregatedFaceRow,
  DetectionIndividual,
  DetectionReportItem,
  DetectionStats,
  FaceMatchResult,
  GrexidDetection as Detection,
  RawDetectionRow,
} from "@systems/grex-id/src/contracts/grexid-detection";

assertServerOnly("detections");

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
    WHERE locationId.tenantIds CONTAINS $sysTenantId
      AND detectedAt >= type::datetime($startDate)
      AND detectedAt <= type::datetime($endDate)`;

  if (params.locationId) {
    whereClause += " AND locationId = $locationId";
    bindings.locationId = rid(params.locationId);
  }
  if (params.cursor) {
    whereClause += " AND id > $cursor";
    bindings.cursor = params.cursor;
  }

  // Single batched query: detections + lead membership via tenantIds
  // LET statements produce null entries in the result array, shifting indices
  const query =
    `LET $sysTenantId = (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId AND !actorId LIMIT 1)[0];

    SELECT * FROM grexid_detection ${whereClause} ORDER BY detectedAt DESC LIMIT $limit FETCH locationId, faceId, leadId, leadId.profileId;

    LET $leadIds = (SELECT VALUE leadId FROM (SELECT leadId, detectedAt FROM grexid_detection ${whereClause} AND leadId ORDER BY detectedAt DESC LIMIT $limit));

    SELECT id AS leadId, ownerId FROM lead
      WHERE id IN $leadIds
        AND tenantIds CONTAINS $sysTenantId
      FETCH ownerId, ownerId.profileId;`;

  const result = await db.query<
    [
      unknown,
      RawDetectionRow[],
      unknown,
      {
        leadId: unknown;
        ownerId:
          | (Record<string, unknown> & {
            id: unknown;
            profileId?: { name?: string };
          })
          | null;
      }[],
    ]
  >(query, bindings);
  const rawItems = result[1] ?? [];
  const assocRows = result[3] ?? [];
  const hasMore = rawItems.length > limit;
  const fetched = hasMore ? rawItems.slice(0, limit) : rawItems;

  const assocMap = new Map<
    string,
    { ownerId?: string; ownerName?: string }
  >();

  for (const row of assocRows) {
    const lid = normalizeRecordId(row.leadId);
    if (!lid) continue;
    const owner = row.ownerId && typeof row.ownerId === "object"
      ? row.ownerId
      : null;
    assocMap.set(lid, {
      ownerId: owner ? normalizeRecordId(owner.id) ?? undefined : undefined,
      ownerName: owner?.profileId?.name ?? undefined,
    });
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
        ? lead?.profileId?.avatarUri ?? undefined
        : undefined,
      leadEmail: isMember ? lead?.email ?? undefined : undefined,
      leadPhone: isMember ? lead?.phone ?? undefined : undefined,
      ownerId: isMember ? assoc?.ownerId : undefined,
      ownerName: isMember ? assoc?.ownerName : undefined,
      classification,
    };
  });

  return {
    items: enriched,
    total: 0,
    hasMore,
    nextCursor: hasMore
      ? enriched[enriched.length - 1]?.id ?? undefined
      : undefined,
  };
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

  let locationFilter = "";
  if (params.locationId) {
    locationFilter = " AND locationId = $locationId";
    bindings.locationId = rid(params.locationId);
  }

  // Single batched query:
  //  1) Per-face aggregation via GROUP BY: count, max score, last detectedAt
  //  2) Raw detections for hourly/daily unique-face counting
  //  3) lead membership check via tenantIds for classification
  // LET statements produce null entries in the result array, shifting indices
  const result = await db.query<
    [
      unknown,
      AggregatedFaceRow[],
      { faceId: unknown; detectedAt: string }[],
      unknown,
      {
        leadId: unknown;
        ownerId:
          | Record<string, unknown> & {
            id: unknown;
            profileId?: { name?: string };
          }
          | null;
      }[],
    ]
  >(
    // 1) Group by faceId — SurrealDB GROUP BY provides count() and aggregate functions
    `LET $sysTenantId = (SELECT VALUE id FROM tenant WHERE companyId = $companyId AND systemId = $systemId AND !actorId LIMIT 1)[0];

    SELECT
        faceId,
        set::at(leadId, 0) AS leadId,
        set::at(locationId, 0) AS locationId,
        count() AS detectionCount,
        math::max(score) AS bestScore,
        time::max(detectedAt) AS lastDetectedAt
      FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDate)${locationFilter}
      GROUP BY faceId
      ORDER BY lastDetectedAt DESC
      FETCH faceId, leadId, leadId.profileId, locationId;

    // 2) Raw faceId + detectedAt for hourly/daily unique counts (lightweight)
    SELECT faceId, detectedAt FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDate)${locationFilter};

    // 3) Batch-check lead membership via tenantIds for classification
    LET $leadIds = (SELECT VALUE leadId
      FROM grexid_detection
      WHERE locationId.tenantIds CONTAINS $sysTenantId
        AND detectedAt >= type::datetime($startDate)
        AND detectedAt <= type::datetime($endDate)${locationFilter}
        AND leadId);

    SELECT id AS leadId, ownerId FROM lead
      WHERE id IN $leadIds
        AND tenantIds CONTAINS $sysTenantId
      FETCH ownerId, ownerId.profileId;`,
    bindings,
  );

  const aggregatedFaces = result[1] ?? [];
  const rawDetections = result[2] ?? [];
  const assocRows = result[4] ?? [];

  // Build membership lookup map
  const assocMap = new Map<string, { ownerId?: string; ownerName?: string }>();
  for (const row of assocRows) {
    const lid = normalizeRecordId(row.leadId);
    if (!lid) continue;
    const owner = row.ownerId && typeof row.ownerId === "object"
      ? row.ownerId
      : null;
    assocMap.set(lid, {
      ownerId: owner ? normalizeRecordId(owner.id) ?? undefined : undefined,
      ownerName: owner?.profileId?.name ?? undefined,
    });
  }

  // Build hourly/daily unique-face counts from raw detections
  const hourlyFaceSet = Array.from({ length: 24 }, () => new Set<string>());
  const dailyFaceSet = Array.from({ length: 7 }, () => new Set<string>());

  for (const det of rawDetections) {
    const fid = normalizeRecordId(det.faceId);
    if (!fid) continue;
    try {
      const date = new Date(det.detectedAt);
      hourlyFaceSet[date.getHours()].add(fid);
      dailyFaceSet[date.getDay()].add(fid);
    } catch {
      // skip invalid dates
    }
  }

  const hourlyUnique = hourlyFaceSet.map((s) => s.size);
  const dailyUnique = dailyFaceSet.map((s) => s.size);

  // Build individuals from aggregated rows
  let uniqueMembers = 0;
  let uniqueVisitors = 0;
  let uniqueUnknowns = 0;
  const individuals: DetectionIndividual[] = [];

  for (const faceRow of aggregatedFaces) {
    const faceRecordId = normalizeRecordId(faceRow.faceId?.id);
    if (!faceRecordId) continue;

    const lead = faceRow.leadId && typeof faceRow.leadId === "object"
      ? faceRow.leadId
      : null;
    const leadRecordId = normalizeRecordId(lead?.id);

    let classification: "member" | "visitor" | "unknown" = "unknown";
    const assoc = leadRecordId ? assocMap.get(leadRecordId) : undefined;
    if (leadRecordId) {
      classification = assoc ? "member" : "visitor";
    }

    if (classification === "member") uniqueMembers++;
    else if (classification === "visitor") uniqueVisitors++;
    else uniqueUnknowns++;

    const isMember = classification === "member";

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
      ownerId: isMember ? assoc?.ownerId : undefined,
      ownerName: isMember ? assoc?.ownerName : undefined,
    });
  }

  return {
    uniqueMembers,
    uniqueVisitors,
    uniqueUnknowns,
    individuals,
    hourlyUnique,
    dailyUnique,
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
