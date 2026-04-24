import {
  markExpiredPayments,
  resolveExpiredPaymentContext,
} from "../db/queries/billing.ts";
import { publish } from "../event-queue/publisher.ts";
import Core from "../utils/Core.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("expire-pending-payments");

const EXPIRY_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function startPaymentExpiry(): void {
  async function checkExpiredPayments() {
    try {
      const core = Core.getInstance();

      const payments = await markExpiredPayments();

      if (payments.length === 0) return;

      console.log(`[expiry] Marked ${payments.length} expired payments.`);

      for (const payment of payments) {
        const { owner, systemInfo } = await resolveExpiredPaymentContext({
          companyId: String(payment.companyId),
          systemId: String(payment.systemId),
          subscriptionId: String(payment.subscriptionId),
        });

        const systemName = systemInfo?.name ?? "";
        const systemSlug = systemInfo?.slug ?? "";

        if (owner?.id) {
          await publish("send_communication", {
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

        await core.reloadSubscription(
          String(payment.companyId),
          String(payment.systemId),
        );
      }
    } catch (err) {
      console.error("[expiry] Error checking expired payments:", err);
    }
  }

  setInterval(checkExpiredPayments, EXPIRY_CHECK_INTERVAL_MS);
  console.log("[expiry] Payment expiry job started (15-minute check).");
}
