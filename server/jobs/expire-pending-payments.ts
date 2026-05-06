import "server-only";

import {
  markExpiredPayments,
  resolveExpiredPaymentContext,
} from "../db/queries/billing.ts";
import { dispatchCommunication } from "../event-queue/handlers/send-communication.ts";
import { get, updateTenantCache } from "../utils/instrumentation-cache.ts";
import { getDb } from "../db/connection.ts";

const EXPIRY_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function startPaymentExpiry(): void {
  async function checkExpiredPayments() {
    try {
      const payments = await markExpiredPayments();

      if (payments.length === 0) return;

      console.log(`[expiry] Marked ${payments.length} expired payments.`);

      for (const payment of payments) {
        const tenantId = String(
          payment.tenantIds instanceof Set
            ? [...payment.tenantIds][0]
            : Array.isArray(payment.tenantIds)
            ? payment.tenantIds[0]
            : payment.tenantIds,
        );

        const { owner, systemInfo } = await resolveExpiredPaymentContext({
          tenantId,
          subscriptionId: String(payment.subscriptionId),
        });

        const systemName = systemInfo?.name ?? "";
        const systemSlug = systemInfo?.slug ?? "";

        if (owner?.id) {
          await dispatchCommunication({
            recipients: [String(owner.id)],
            template: "notification",
            templateData: {
              eventKey: `billing.event.paymentExpired.${payment.kind}`,
              occurredAt: new Date().toISOString(),
              actorName: owner.name ?? "",
              systemName,
              value: {
                amount: payment.amount,
                currency: payment.currency ?? "USD",
              },
              ctaKey: "templates.notification.cta.viewBilling",
              ctaUrl: `/billing?systemSlug=${systemSlug}`,
              resources: [`billing.paymentKind.${payment.kind}`],
              systemSlug,
            },
          });
        }

        // Resolve systemId/companyId from tenant row for cache invalidation
        const coreData = await get(undefined, "core-data") as any;
        const systemId = systemSlug
          ? coreData?.systemsBySlug?.[systemSlug]?.id
          : undefined;
        let companyId: string | undefined;
        if (systemId && tenantId) {
          const db = await getDb();
          const tenantRows = await db.query<[{ companyId: string }[]]>(
            "SELECT companyId FROM tenant WHERE id = $id LIMIT 1",
            { id: tenantId },
          );
          companyId = tenantRows[0]?.[0]?.companyId;
        }

        if (systemId && companyId) {
          updateTenantCache({ systemId, companyId }, "subscription");
        }
      }
    } catch (err) {
      console.error("[expiry] Error checking expired payments:", err);
    }
  }

  setInterval(checkExpiredPayments, EXPIRY_CHECK_INTERVAL_MS);
  console.log("[expiry] Payment expiry job started (15-minute check).");
}
