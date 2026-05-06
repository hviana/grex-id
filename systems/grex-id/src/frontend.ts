import { registerComponent, registerHomePage } from "@/src/frontend-registry";

export function registerFrontend(): void {
  registerComponent(
    "grexid-locations",
    () => import("./components/LocationsPage"),
  );
  registerComponent(
    "grexid-leads",
    () => import("./components/LeadsPage"),
  );
  registerComponent(
    "grexid-detections",
    () => import("./components/DetectionReportPage"),
  );
  registerComponent(
    "grexid-settings",
    () => import("./components/SettingsPage"),
  );

  registerHomePage(
    "grex-id",
    () => import("./components/HomePage"),
  );
}
