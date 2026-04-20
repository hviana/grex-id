import { getDb, rid } from "@/server/db/connection";
import { getSetting } from "@/server/db/queries/systems/grex-id/settings";
import { getLocationById } from "@/server/db/queries/locations";
import type { HandlerFn } from "@/server/event-queue/worker";

export const processDetection: HandlerFn = async (payload) => {
  const locationId = payload.locationId as string;
  const embeddings = payload.embeddings as number[][];
  const eventId = payload.eventId as string | undefined;

  const location = await getLocationById(locationId);
  if (!location) {
    throw new Error(`Location not found: ${locationId}`);
  }

  const sensitivity = parseFloat(
    await getSetting(
      location.companyId,
      location.systemId,
      "detection.sensitivity",
    ),
  );

  const db = await getDb();

  // Idempotency: check if detections for this event already exist
  if (eventId) {
    const existing = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM grexid_detection
       WHERE locationId = $locationId
         AND eventId = $eventId
       LIMIT 1`,
      { locationId: rid(locationId), eventId },
    );
    if ((existing[0] ?? []).length > 0) {
      return;
    }
  }

  // Process each embedding and batch all creates into a single db.query (§7.2)
  const statements: string[] = [];
  const bindings: Record<string, unknown> = {
    locationId: rid(locationId),
  };

  for (let i = 0; i < embeddings.length; i++) {
    // Search for matching face
    const matchResult = await db.query<
      [{ id: unknown; leadId: unknown; score: number }[]]
    >(
      `SELECT id, leadId, vector::distance::knn() AS score
       FROM face
       WHERE embedding_type1 <|1,40|> $embedding_${i}
       ORDER BY score`,
      { [`embedding_${i}`]: embeddings[i] },
    );
    const bestMatch = matchResult[0]?.[0];
    const score = bestMatch?.score ?? 0;

    if (bestMatch && score >= sensitivity) {
      // Known face — create detection linked to existing face and lead
      bindings[`faceId_${i}`] = bestMatch.id;
      bindings[`leadId_${i}`] = bestMatch.leadId ?? null;
      bindings[`score_${i}`] = score;
      let setClause =
        `locationId = $locationId, faceId = $faceId_${i}, score = $score_${i}`;
      if (bestMatch.leadId) {
        setClause += `, leadId = $leadId_${i}`;
      }
      if (eventId) {
        setClause += `, eventId = $eventId`;
      }
      statements.push(
        `CREATE grexid_detection SET ${setClause}, detectedAt = time::now()`,
      );
    } else {
      // Unknown face — create orphan face + detection in one batched query
      bindings[`embedding_${i}`] = embeddings[i];
      bindings[`score_${i}`] = score;
      let detectionSets = `locationId = $locationId, score = $score_${i}`;
      if (eventId) {
        detectionSets += `, eventId = $eventId`;
      }
      statements.push(
        `LET $face_${i} = (CREATE face SET leadId = NONE, embedding_type1 = $embedding_${i});
         CREATE grexid_detection SET ${detectionSets}, faceId = $face_${i}[0].id, detectedAt = time::now()`,
      );
    }
  }

  if (eventId) {
    bindings.eventId = eventId;
  }

  if (statements.length > 0) {
    await db.query(statements.join(";\n"), bindings);
  }
};
