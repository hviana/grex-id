import "server-only";

import { Worker } from "../event-queue/worker.ts";
import { getAllHandlers, getHandler } from "../module-registry.ts";
import type { WorkerConfig } from "@/src/contracts/high-level/worker-config";

const defaultConfig: Omit<WorkerConfig, "handler"> = {
  maxConcurrency: 3,
  batchSize: 5,
  leaseDurationMs: 30_000,
  idleDelayMs: 5_000,
  retryBackoffBaseMs: 1_000,
  maxAttempts: 5,
};

export function startEventQueue(): void {
  const names = getAllHandlers();

  for (const name of names) {
    const fn = getHandler(name);
    if (!fn) continue;

    const config: WorkerConfig = { ...defaultConfig, handler: name };
    const worker = new Worker(config, fn);
    worker.start().catch((err) => {
      console.error(`[event-queue] Worker for ${name} crashed:`, err);
    });
  }

  console.log(`[event-queue] Started workers for: ${names.join(", ")}`);
}
