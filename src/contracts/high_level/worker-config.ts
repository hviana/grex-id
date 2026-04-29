export interface WorkerConfig {
  handler: string;
  maxConcurrency: number;
  batchSize: number;
  leaseDurationMs: number;
  idleDelayMs: number;
  retryBackoffBaseMs: number;
  maxAttempts: number;
}
