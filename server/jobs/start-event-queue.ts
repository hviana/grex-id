import { Worker } from "../event-queue/worker.ts";
import { getAllHandlerNames } from "../event-queue/registry.ts";
import { sendEmail } from "../event-queue/handlers/send-email.ts";
import { sendSms } from "../event-queue/handlers/send-sms.ts";
import { processPayment } from "../event-queue/handlers/process-payment.ts";
import { handleAutoRecharge } from "../event-queue/handlers/auto-recharge.ts";
import { processDetection } from "../event-queue/handlers/systems/grex-id/process-detection.ts";
import type { HandlerFn } from "../event-queue/worker.ts";
import type { WorkerConfig } from "@/src/contracts/event-queue";

const handlerFunctions: Record<string, HandlerFn> = {
  send_email: sendEmail,
  send_sms: sendSms,
  process_payment: processPayment,
  auto_recharge: handleAutoRecharge,
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
