import type { HandlerFn } from "./event-queue/worker.ts";
import type { TemplateFunction } from "../src/contracts/communication.ts";

export {
  getAllHandlerNames,
  getHandlersForEvent,
  registerEventHandler,
} from "./event-queue/registry.ts";

export {
  getComponent,
  getHomePage,
  registerComponent,
  registerHomePage,
} from "../src/components/systems/registry.ts";

export { registerSystemI18n } from "../src/i18n/index.ts";

// ── Cache ─────────────────────────────────────────────────
// Centralized cache registry (§12.11).

export {
  clearAllCacheForSlug,
  clearCache,
  getCache,
  getCacheIfLoaded,
  registerCache,
  updateCache,
} from "./utils/cache.ts";

// ── Handler functions ─────────────────────────────────────
// Maps handler name → executable HandlerFn.

const handlerFunctionRegistry: Record<string, HandlerFn> = {};

export function registerHandlerFunction(name: string, fn: HandlerFn): void {
  handlerFunctionRegistry[name] = fn;
}

export function getHandlerFunction(name: string): HandlerFn | undefined {
  return handlerFunctionRegistry[name];
}

// ── Jobs ──────────────────────────────────────────────────
// Maps job name → start function for non-event-queue recurring jobs.

type JobStarter = () => void;

const jobRegistry: Record<string, JobStarter> = {};

export function registerJob(name: string, startFn: JobStarter): void {
  jobRegistry[name] = startFn;
}

export function getAllJobs(): Record<string, JobStarter> {
  return { ...jobRegistry };
}

// ── Communication templates ───────────────────────────────
// Maps template name → TemplateFunction.
// Core and subsystems register their email/SMS templates here.

const templateRegistry: Record<string, TemplateFunction> = {};

export function registerTemplate<T extends Record<string, unknown>>(
  name: string,
  fn: TemplateFunction<T>,
): void {
  templateRegistry[name] = fn as TemplateFunction;
}

export function getTemplate(name: string): TemplateFunction | undefined {
  return templateRegistry[name];
}

// ── Lifecycle hooks ───────────────────────────────────────
// Subsystems register hooks that the core invokes at specific points.
// This avoids the core importing subsystem code or checking slugs.

type LifecycleHook = (payload: Record<string, unknown>) => Promise<void>;

interface LifecycleRegistry {
  "lead:delete": LifecycleHook[];
  "lead:verify": LifecycleHook[];
}

const lifecycleHooks: LifecycleRegistry = {
  "lead:delete": [],
  "lead:verify": [],
};

type LifecycleEvent = keyof LifecycleRegistry;

export function registerLifecycleHook(
  event: LifecycleEvent,
  hook: LifecycleHook,
): void {
  lifecycleHooks[event].push(hook);
}

export async function runLifecycleHooks(
  event: LifecycleEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = lifecycleHooks[event];
  for (const hook of hooks) {
    await hook(payload);
  }
}
