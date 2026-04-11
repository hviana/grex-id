export interface QueueEvent {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  availableAt: string;
  createdAt: string;
}

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

export interface WorkerConfig {
  handler: string;
  maxConcurrency: number;
  batchSize: number;
  leaseDurationMs: number;
  idleDelayMs: number;
  retryBackoffBaseMs: number;
  maxAttempts: number;
}
