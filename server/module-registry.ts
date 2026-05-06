import "server-only";

import type {
  TemplateBuilder,
  TemplateFunction,
} from "../src/contracts/high-level/communication.ts";

// Register all subsystem/framework components for SSR
import "@/src/frontend-registry";

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
} from "../src/frontend-registry.ts";

export {
  loadAllTranslations,
  registerFrameworkI18n,
  registerSystemI18n,
} from "./i18n-registry.ts";

// ── Cache ─────────────────────────────────────────────────

export {
  buildMenuTree,
  buildScopeKey,
  compilePattern,
  deriveActorType,
  get,
  limitsMerger,
  revalidateTenantCache,
  updateTenantCache,
} from "./utils/cache.ts";

export * as instrumentationCache from "./utils/instrumentation-cache.ts";
import type {
  JobStarter,
  LifecycleEvent,
  LifecycleHook,
  ModuleRegistryState,
} from "../src/contracts/high-level/module-registry.ts";

import { getState } from "./global-registry.ts";

const reg = getState<ModuleRegistryState>("__grex_module_registries__", {
  jobs: {},
  templates: {},
  templateBuilders: {},
  channels: new Set(),
  lifecycleHooks: { "lead:delete": [], "lead:verify": [] },
});

// ── Jobs ──────────────────────────────────────────────────

export function registerJob(name: string, startFn: JobStarter): void {
  reg.jobs[name] = startFn;
}

export function getAllJobs(): Record<string, JobStarter> {
  return { ...reg.jobs };
}

// ── Communication templates ───────────────────────────────
// Static per-channel templates. Key shape: "<channel>:<path>".

// deno-lint-ignore no-explicit-any
export function registerTemplate(
  channel: string,
  path: string,
  fn: (locale: string, data: any) => Promise<{ body: string; title?: string }>,
): void {
  reg.templates[`${channel}:${path}`] = fn as TemplateFunction;
}

export function getTemplate(
  channel: string,
  path: string,
): TemplateFunction | undefined {
  return reg.templates[`${channel}:${path}`];
}

// ── Dynamic template builders ─────────────────────────────

export function registerTemplateBuilder(
  name: string,
  fn: TemplateBuilder,
): void {
  reg.templateBuilders[name] = fn;
}

export function getTemplateBuilder(name: string): TemplateBuilder | undefined {
  return reg.templateBuilders[name];
}

// ── Channel registry ──────────────────────────────────────
// The per-channel handler name is always `send_<channel>` by convention.
// This registry only tracks which channels exist so the dispatcher can skip
// unregistered ones and frameworks can advertise new channels.

export function registerChannel(channel: string): void {
  reg.channels.add(channel);
}

export function hasChannel(channel: string): boolean {
  return reg.channels.has(channel);
}

export function channelHandlerName(channel: string): string {
  return `send_${channel}`;
}

// ── Lifecycle hooks ───────────────────────────────────────

export function registerLifecycleHook(
  event: LifecycleEvent,
  hook: LifecycleHook,
): void {
  reg.lifecycleHooks[event].push(hook);
}

export async function runLifecycleHooks(
  event: LifecycleEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = reg.lifecycleHooks[event];
  for (const hook of hooks) {
    await hook(payload);
  }
}
