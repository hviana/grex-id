// ============================================================================
// Event queue types
// ============================================================================

/** Delivery candidate returned by claimCandidateDeliveries (server/db/queries/event-queue.ts). */
export interface CandidateDelivery {
  id: string;
  eventId: string;
  attempts: number;
  maxAttempts: number;
}

/** Handler function signature for event-queue workers (server/event-queue/worker.ts). */
export type HandlerFn = (payload: Record<string, unknown>) => Promise<void>;
