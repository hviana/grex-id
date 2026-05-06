import "server-only";

import type { HandlerFn } from "@/src/contracts/high-level/event-queue";

/**
 * One name per handler. The name is both the event (what `publish()` accepts)
 * and the function key (what the worker looks up).
 */
const handlerRegistry = new Map<string, HandlerFn>();

export function registerHandler(name: string, fn: HandlerFn): void {
  handlerRegistry.set(name, fn);
}

export function getHandler(name: string): HandlerFn | undefined {
  return handlerRegistry.get(name);
}

export function hasHandler(name: string): boolean {
  return handlerRegistry.has(name);
}

export function getAllHandlers(): string[] {
  return [...handlerRegistry.keys()];
}
