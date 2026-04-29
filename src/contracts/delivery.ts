export interface Delivery {
  id: string;
  eventId: string;
  handler: string;
  status: "pending" | "processing" | "done" | "dead";
  availableAt: string;
  leaseUntil?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  workerId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
