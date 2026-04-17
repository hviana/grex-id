import { registerCore } from "../core-register.ts";
import { registerAllSystems } from "../../systems/index.ts";
import { registerAllFrameworks } from "../../frameworks/index.ts";
import { getAllJobs } from "../module-registry.ts";
import { startEventQueue } from "./start-event-queue.ts";

export async function startAllJobs(): Promise<void> {
  registerCore();
  registerAllSystems();
  registerAllFrameworks();

  startEventQueue();

  const jobs = getAllJobs();
  console.log("[jobs] Starting all background jobs...");
  for (const [name, startFn] of Object.entries(jobs)) {
    console.log(`[jobs] Starting: ${name}`);
    startFn();
  }
  console.log("[jobs] All jobs started.");
}
