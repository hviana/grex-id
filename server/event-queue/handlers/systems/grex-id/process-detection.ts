import {
  createOrphanFace,
  searchFaceByEmbedding,
} from "@/server/db/queries/systems/grex-id/faces";
import { createDetection } from "@/server/db/queries/systems/grex-id/detections";
import { getSetting } from "@/server/db/queries/systems/grex-id/settings";
import { getLocationById } from "@/server/db/queries/locations";
import { getDb, rid } from "@/server/db/connection";
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

  // Idempotency: check if detections for this event + location already exist
  if (eventId) {
    const db = await getDb();
    const existing = await db.query<[{ id: unknown }[]]>(
      `SELECT id FROM grexid_detection
       WHERE locationId = $locationId
         AND metadata.eventId = $eventId
       LIMIT 1`,
      { locationId: rid(locationId), eventId },
    );
    if ((existing[0] ?? []).length > 0) {
      return;
    }
  }

  // Process each embedding — sequential is acceptable here since each
  // embedding produces independent face search + detection creation,
  // and the event queue handles concurrency with lease-based locking.
  for (const embedding of embeddings) {
    const matches = await searchFaceByEmbedding(embedding, 1, 40);
    const bestMatch = matches[0];

    let detectedLeadId: string | undefined;
    let detectedFaceId: string | undefined;
    let score = 0;

    if (bestMatch && bestMatch.score >= sensitivity) {
      detectedLeadId = bestMatch.leadId ?? undefined;
      detectedFaceId = bestMatch.id;
      score = bestMatch.score;
    } else {
      // Unknown face — create orphan face record for later lead linking
      score = bestMatch?.score ?? 0;
      const orphan = await createOrphanFace(embedding);
      detectedFaceId = orphan.id;
    }

    await createDetection({
      locationId,
      leadId: detectedLeadId,
      faceId: detectedFaceId,
      score,
    });
  }
};
