import { getDb } from "../db/connection";
import type { WorkerConfig } from "@/src/contracts/event-queue";

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
    const db = await getDb();

    const claimed = await db.query<[{
      id: string;
      eventId: string;
      attempts: number;
      maxAttempts: number;
    }[]]>(
      `SELECT id, eventId, attempts, maxAttempts, availableAt FROM delivery
       WHERE handler = $handler
         AND status = "pending"
         AND availableAt <= time::now()
         AND (leaseUntil IS NONE OR leaseUntil <= time::now())
       ORDER BY availableAt ASC
       LIMIT $limit`,
      { handler: this.config.handler, limit: batchSize },
    );

    const deliveries = claimed[0] ?? [];
    if (deliveries.length === 0) {
      await this.sleep(this.config.idleDelayMs);
      return;
    }

    const leaseUntil = new Date(Date.now() + this.config.leaseDurationMs);

    const promises = deliveries.map(async (delivery) => {
      const updated = await db.query<[Record<string, unknown>[]]>(
        `UPDATE $id SET
          status = "processing",
          leaseUntil = $leaseUntil,
          workerId = $workerId,
          attempts = attempts + 1,
          startedAt = time::now()
        WHERE status = "pending"
        RETURN AFTER`,
        { id: delivery.id, leaseUntil, workerId: this.workerId },
      );

      if (!updated[0]?.length) return;

      this.activeCount++;
      try {
        const events = await db.query<[{ payload: Record<string, unknown> }[]]>(
          "SELECT payload FROM queue_event WHERE id = $eventId LIMIT 1",
          { eventId: delivery.eventId },
        );

        const payload = events[0]?.[0]?.payload ?? {};
        await this.handlerFn(payload);

        await db.query(
          `UPDATE $id SET
            status = "done",
            leaseUntil = NONE,
            finishedAt = time::now(),
            lastError = NONE`,
          { id: delivery.id },
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newAttempts = delivery.attempts + 1;

        if (newAttempts >= delivery.maxAttempts) {
          await db.query(
            `UPDATE $id SET
              status = "dead",
              leaseUntil = NONE,
              lastError = $error,
              finishedAt = time::now()`,
            { id: delivery.id, error: errorMsg },
          );
        } else {
          const backoff = this.config.retryBackoffBaseMs *
            Math.pow(2, newAttempts - 1);
          const nextAvailable = new Date(Date.now() + backoff);
          await db.query(
            `UPDATE $id SET
              status = "pending",
              leaseUntil = NONE,
              availableAt = $nextAvailable,
              lastError = $error`,
            { id: delivery.id, nextAvailable, error: errorMsg },
          );
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
