import { Worker } from "../event-queue/worker.ts";
import { getAllHandlerNames } from "../event-queue/registry.ts";
import { getHandlerFunction } from "../module-registry.ts";
import type { WorkerConfig } from "@/src/contracts/event-queue";

const defaultConfig: Omit<WorkerConfig, "handler"> = {
  maxConcurrency: 3,
  batchSize: 5,
  leaseDurationMs: 30_000,
  idleDelayMs: 5_000,
  retryBackoffBaseMs: 1_000,
  maxAttempts: 5,
};

export function startEventQueue(): void {
  const handlers = getAllHandlerNames();

  for (const handler of handlers) {
    const fn = getHandlerFunction(handler);
    if (!fn) {
      console.warn(
        `[event-queue] No function registered for handler: ${handler}`,
      );
      continue;
    }

    const config: WorkerConfig = { ...defaultConfig, handler };
    const worker = new Worker(config, fn);
    worker.start().catch((err) => {
      console.error(`[event-queue] Worker for ${handler} crashed:`, err);
    });
  }

  console.log(`[event-queue] Started workers for: ${handlers.join(", ")}`);
}
