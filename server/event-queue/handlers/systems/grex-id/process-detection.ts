import { genericGetById } from "@/server/db/queries/generics";
import {
  batchCreateDetections,
  detectionExistsForEvent,
  searchMatchingFace,
} from "@/server/db/queries/systems/grex-id/detections";
import { rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import type { HandlerFn } from "@/server/event-queue/worker";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("process-detection");

export const processDetection: HandlerFn = async (payload) => {
  const locationId = payload.locationId as string;
  const embeddings = payload.embeddings as number[][];
  const eventId = payload.eventId as string | undefined;

  const location = await genericGetById<
    { companyId: string; systemId: string }
  >({ table: "location" }, locationId);
  if (!location) {
    throw new Error(`Location not found: ${locationId}`);
  }

  const sensitivity = parseFloat(
    (await Core.getInstance().getSetting(
      "detection.sensitivity",
      { systemId: location.systemId, companyId: location.companyId },
    )) ?? "0.5",
  );

  // Idempotency: check if detections for this event already exist
  if (eventId) {
    const exists = await detectionExistsForEvent(locationId, eventId);
    if (exists) {
      return;
    }
  }

  // Process each embedding and batch all creates into a single query (§7.2)
  const statements: string[] = [];
  const bindings: Record<string, unknown> = {
    locationId: rid(locationId),
  };

  for (let i = 0; i < embeddings.length; i++) {
    const bestMatch = await searchMatchingFace(embeddings[i], i);
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

  await batchCreateDetections(statements, bindings);
};
