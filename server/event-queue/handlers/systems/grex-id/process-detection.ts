import {
  searchFaceByEmbedding,
  createOrphanFace,
} from "@/server/db/queries/systems/grex-id/faces";
import { createDetection } from "@/server/db/queries/systems/grex-id/detections";
import { getSetting } from "@/server/db/queries/systems/grex-id/settings";
import { getLocationById } from "@/server/db/queries/locations";
import type { HandlerFn } from "@/server/event-queue/worker";

export const processDetection: HandlerFn = async (payload) => {
  const locationId = payload.locationId as string;
  const embeddings = payload.embeddings as number[][];

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
