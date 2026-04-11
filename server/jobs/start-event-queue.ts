import { Worker } from "../event-queue/worker";
import { getAllHandlerNames } from "../event-queue/registry";
import { sendEmail } from "../event-queue/handlers/send-email";
import { sendSms } from "../event-queue/handlers/send-sms";
import { processPayment } from "../event-queue/handlers/process-payment";
import { processDetection } from "../event-queue/handlers/systems/grex-id/process-detection";
import type { HandlerFn } from "../event-queue/worker";
import type { WorkerConfig } from "@/src/contracts/event-queue";

const handlerFunctions: Record<string, HandlerFn> = {
  send_email: sendEmail,
  send_sms: sendSms,
  process_payment: processPayment,
  grexid_process_detection: processDetection,
};

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
    const fn = handlerFunctions[handler];
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
