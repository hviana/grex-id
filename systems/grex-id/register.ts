import "server-only";
import {
  registerHandler,
  registerLifecycleHook,
  registerSystemI18n,
} from "@/server/module-registry";
import { processDetection } from "./server/event-queue/handlers/process-detection";
import { deleteFaceByLeadId } from "./server/db/queries/faces";
import { tryUpsertFace } from "./server/db/queries/faces";

export function register(): void {
  // Event handlers — name is both the event and the function key
  registerHandler("grexid_process_detection", processDetection);

  // i18n
  registerSystemI18n(
    "grex-id",
    "en",
    () => import("./src/i18n/en/grex-id.json"),
  );
  registerSystemI18n(
    "grex-id",
    "pt-BR",
    () => import("./src/i18n/pt-BR/grex-id.json"),
  );

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
