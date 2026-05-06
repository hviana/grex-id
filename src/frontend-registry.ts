// Frontend component registry.
// Centralizes all component/homepage registration and lookup.
// Imported by server/module-registry.ts (SSR), app/layout.tsx (server),
// and TenantProvider (client bundle).
// This file is NOT server-only.

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { registerAllSystemsFrontend } from "@/systems/frontend";
import { registerAllFrameworksFrontend } from "@/frameworks/frontend";

// ── Registries ────────────────────────────────────────────

const componentRegistry: Record<string, LazyExoticComponent<ComponentType>> = {
  usage: lazy(() => import("@/src/components/shared/UsagePage")),
  billing: lazy(() => import("@/src/components/shared/BillingPage")),
  profile: lazy(() => import("@/src/components/shared/ProfilePage")),
  "users-list": lazy(() => import("@/src/components/shared/UsersPage")),
  "groups": lazy(() => import("@/src/components/shared/GroupsPage")),
  "company-edit": lazy(() => import("@/src/components/shared/CompanyEditPage")),
  "connected-apps": lazy(
    () => import("@/src/components/shared/ConnectedAppsPage"),
  ),
  tokens: lazy(() => import("@/src/components/shared/TokensPage")),
  "connected-services": lazy(
    () => import("@/src/components/shared/ConnectedServicesPage"),
  ),
};

const homepageRegistry: Record<string, LazyExoticComponent<ComponentType>> = {};

// ── Component API ─────────────────────────────────────────

export function registerComponent(
  name: string,
  loader: () => Promise<{ default: ComponentType }>,
): void {
  componentRegistry[name] = lazy(loader);
}

export function getComponent(
  name: string,
): LazyExoticComponent<ComponentType> | null {
  return componentRegistry[name] ?? null;
}

export { componentRegistry };

// ── Homepage API ──────────────────────────────────────────

export function registerHomePage(
  systemSlug: string,
  loader: () => Promise<{ default: ComponentType }>,
): void {
  homepageRegistry[systemSlug] = lazy(loader);
}

export function getHomePage(
  systemSlug: string,
): LazyExoticComponent<ComponentType> | null {
  return homepageRegistry[systemSlug] ?? null;
}

// ── Bootstrap ─────────────────────────────────────────────

registerAllSystemsFrontend();
registerAllFrameworksFrontend();
