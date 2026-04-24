import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

const componentRegistry: Record<string, LazyExoticComponent<ComponentType>> = {
  usage: lazy(() => import("@/src/components/shared/UsagePage")),
  billing: lazy(() => import("@/src/components/shared/BillingPage")),
  profile: lazy(() => import("@/src/components/shared/ProfilePage")),
  "users-list": lazy(() => import("@/src/components/shared/UsersPage")),
  "company-edit": lazy(() => import("@/src/components/shared/CompanyEditPage")),
  "connected-apps": lazy(
    () => import("@/src/components/shared/ConnectedAppsPage"),
  ),
  tokens: lazy(() => import("@/src/components/shared/TokensPage")),
  "connected-services": lazy(
    () => import("@/src/components/shared/ConnectedServicesPage"),
  ),
  "grexid-locations": lazy(
    () => import("@/src/components/systems/grex-id/LocationsPage"),
  ),
  "grexid-leads": lazy(
    () => import("@/src/components/systems/grex-id/LeadsPage"),
  ),
  "grexid-detections": lazy(
    () => import("@/src/components/systems/grex-id/DetectionReportPage"),
  ),
  "grexid-settings": lazy(
    () => import("@/src/components/systems/grex-id/SettingsPage"),
  ),
};

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

// --- Homepage registry ---
// Each system registers its own homepage component keyed by system slug.
// Example: registerHomePage("my-system", () => import("@/src/components/systems/my-system/HomePage"))
const homepageRegistry: Record<string, LazyExoticComponent<ComponentType>> = {
  "grex-id": lazy(
    () => import("@/src/components/systems/grex-id/HomePage"),
  ),
};

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
