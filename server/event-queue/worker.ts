import type { WorkerConfig } from "@/src/contracts/event-queue";
import {
  claimCandidateDeliveries,
  getEventPayload,
  leaseDelivery,
  markDeliveryDead,
  markDeliveryDone,
  retryDelivery,
} from "../db/queries/event-queue.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("worker");

export type HandlerFn = (payload: Record<string, unknown>) => Promise<void>;

export class Worker {
  private config: WorkerConfig;
  private handlerFn: HandlerFn;
  private activeCount = 0;
  private running = false;
  private workerId: string;

  constructor(config: WorkerConfig, handlerFn: HandlerFn) {
    this.config = config;
    this.handlerFn = handlerFn;
    this.workerId = `worker-${config.handler}-${
      crypto.randomUUID().slice(0, 8)
    }`;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(
      `[worker] ${this.workerId} started for handler: ${this.config.handler}`,
    );

    while (this.running) {
      try {
        await this.cycle();
      } catch (err) {
        console.error(`[worker] ${this.workerId} cycle error:`, err);
        await this.sleep(this.config.idleDelayMs);
      }
    }
  }

  stop(): void {
    this.running = false;
    console.log(`[worker] ${this.workerId} stopping...`);
  }

  private async cycle(): Promise<void> {
    const freeSlots = this.config.maxConcurrency - this.activeCount;
    if (freeSlots <= 0) {
      await this.sleep(100);
      return;
    }

    const batchSize = Math.min(freeSlots, this.config.batchSize);

    const deliveries = await claimCandidateDeliveries(
      this.config.handler,
      batchSize,
    );

    if (deliveries.length === 0) {
      await this.sleep(this.config.idleDelayMs);
      return;
    }

    const leaseUntil = new Date(Date.now() + this.config.leaseDurationMs);

    const promises = deliveries.map(async (delivery) => {
      const leased = await leaseDelivery(
        delivery.id,
        leaseUntil,
        this.workerId,
      );

      if (!leased) return;

      this.activeCount++;
      try {
        const payload = await getEventPayload(delivery.eventId);
        await this.handlerFn(payload);

        await markDeliveryDone(delivery.id);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newAttempts = delivery.attempts + 1;

        if (newAttempts >= delivery.maxAttempts) {
          await markDeliveryDead(delivery.id, errorMsg);
        } else {
          const backoff = this.config.retryBackoffBaseMs *
            Math.pow(2, newAttempts - 1);
          const nextAvailable = new Date(Date.now() + backoff);
          await retryDelivery(delivery.id, nextAvailable, errorMsg);
        }
      } finally {
        this.activeCount--;
      }
    });

    await Promise.all(promises);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
