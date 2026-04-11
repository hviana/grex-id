import { searchFaceByEmbedding } from "@/server/db/queries/systems/grex-id/faces";
import { createDetection } from "@/server/db/queries/systems/grex-id/detections";
import { getSetting } from "@/server/db/queries/systems/grex-id/settings";
import type { HandlerFn } from "@/server/event-queue/worker";

export const processDetection: HandlerFn = async (payload) => {
  const locationId = payload.locationId as string;
  const embedding = payload.embedding as number[];
  const companyId = payload.companyId as string;
  const systemId = payload.systemId as string;

  const sensitivity = parseFloat(
    await getSetting(companyId, systemId, "detection.sensitivity"),
  );

  const matches = await searchFaceByEmbedding(embedding, 1, 40);
  const bestMatch = matches[0];

  let detectedLeadId: string | undefined;
  let score = 0;

  if (bestMatch && bestMatch.score <= (1 - sensitivity)) {
    detectedLeadId = bestMatch.leadId;
    score = bestMatch.score;
  } else {
    score = bestMatch?.score ?? 1;
  }

  await createDetection({
    locationId,
    leadId: detectedLeadId,
    score,
  });
};
