import type {
  TemplateBuilder,
  TemplateFunction,
} from "../src/contracts/communication.ts";

export {
  getAllHandlers,
  getHandler,
  hasHandler,
  registerHandler,
} from "./event-queue/registry.ts";

export {
  getComponent,
  getHomePage,
  registerComponent,
  registerHomePage,
} from "../src/components/systems/registry.ts";

export { registerSystemI18n } from "../src/i18n/index.ts";

// ── Cache ─────────────────────────────────────────────────

export {
  clearAllCacheForSlug,
  clearCache,
  getCache,
  getCacheIfLoaded,
  registerCache,
  updateCache,
} from "./utils/cache.ts";

// ── Jobs ──────────────────────────────────────────────────

type JobStarter = () => void;

const jobRegistry: Record<string, JobStarter> = {};

export function registerJob(name: string, startFn: JobStarter): void {
  jobRegistry[name] = startFn;
}

export function getAllJobs(): Record<string, JobStarter> {
  return { ...jobRegistry };
}

// ── Communication templates ───────────────────────────────
// Static per-channel templates. Key shape: "<channel>:<path>".

const templateRegistry: Record<string, TemplateFunction> = {};

export function registerTemplate<T extends Record<string, unknown>>(
  channel: string,
  path: string,
  fn: TemplateFunction<T>,
): void {
  templateRegistry[`${channel}:${path}`] = fn as TemplateFunction;
}

export function getTemplate(
  channel: string,
  path: string,
): TemplateFunction | undefined {
  return templateRegistry[`${channel}:${path}`];
}

// ── Dynamic template builders ─────────────────────────────

const templateBuilderRegistry: Record<string, TemplateBuilder> = {};

export function registerTemplateBuilder(
  name: string,
  fn: TemplateBuilder,
): void {
  templateBuilderRegistry[name] = fn;
}

export function getTemplateBuilder(name: string): TemplateBuilder | undefined {
  return templateBuilderRegistry[name];
}

// ── Channel registry ──────────────────────────────────────
// The per-channel handler name is always `send_<channel>` by convention.
// This registry only tracks which channels exist so the dispatcher can skip
// unregistered ones and frameworks can advertise new channels.

const channelRegistry = new Set<string>();

export function registerChannel(channel: string): void {
  channelRegistry.add(channel);
}

export function hasChannel(channel: string): boolean {
  return channelRegistry.has(channel);
}

export function channelHandlerName(channel: string): string {
  return `send_${channel}`;
}

// ── Lifecycle hooks ───────────────────────────────────────

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
