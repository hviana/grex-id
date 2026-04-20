import {
  registerComponent,
  registerEventHandler,
  registerHandlerFunction,
  registerHomePage,
  registerLifecycleHook,
  registerSystemI18n,
} from "@/server/module-registry";
import { processDetection } from "@/server/event-queue/handlers/systems/grex-id/process-detection";
import { deleteFaceByLeadId } from "@/server/db/queries/systems/grex-id/faces";
import { tryUpsertFace } from "@/server/db/queries/systems/grex-id/faces";
import enGrexId from "@/src/i18n/en/systems/grex-id.json";
import ptBRGrexId from "@/src/i18n/pt-BR/systems/grex-id.json";

export function register(): void {
  // Event handlers
  registerEventHandler("GREXID_DETECTION", "grexid_process_detection");
  registerHandlerFunction("grexid_process_detection", processDetection);

  // Components
  registerComponent(
    "grexid-locations",
    () => import("@/src/components/systems/grex-id/LocationsPage"),
  );
  registerComponent(
    "grexid-leads",
    () => import("@/src/components/systems/grex-id/LeadsPage"),
  );
  registerComponent(
    "grexid-detections",
    () => import("@/src/components/systems/grex-id/DetectionReportPage"),
  );
  registerComponent(
    "grexid-settings",
    () => import("@/src/components/systems/grex-id/SettingsPage"),
  );

  // Homepage
  registerHomePage(
    "grex-id",
    () => import("@/src/components/systems/grex-id/HomePage"),
  );

  // i18n
  registerSystemI18n("grex-id", "en", enGrexId);
  registerSystemI18n("grex-id", "pt-BR", ptBRGrexId);

  // Lifecycle hooks
  registerLifecycleHook("lead:delete", async ({ leadId }) => {
    if (typeof leadId === "string") {
      await deleteFaceByLeadId(leadId);
    }
  });

  registerLifecycleHook("lead:verify", async (payload) => {
    const { leadId, faceDescriptor, systemSlug, systemId } = payload;
    if (
      typeof leadId === "string" &&
      Array.isArray(faceDescriptor) &&
      faceDescriptor.length > 0 &&
      typeof systemSlug === "string" &&
      typeof systemId === "string"
    ) {
      await tryUpsertFace(
        {
          leadId,
          embedding_type1: faceDescriptor as number[],
        },
        {
          route: "lifecycle:lead:verify",
          systemSlug,
          systemId,
        },
      );
    }
  });
}
