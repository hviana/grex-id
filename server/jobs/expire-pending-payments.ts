import { getDb, rid } from "../db/connection.ts";
import { publish } from "../event-queue/publisher.ts";
import Core from "../utils/Core.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("expire-pending-payments");

const EXPIRY_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function startPaymentExpiry(): void {
  async function checkExpiredPayments() {
    try {
      const db = await getDb();
      const core = Core.getInstance();

      // Mark expired payments and return their data (§7.2)
      const expired = await db.query<
        [
          {
            id: string;
            companyId: string;
            systemId: string;
            subscriptionId: string;
            kind: string;
            amount: number;
            currency: string;
          }[],
        ]
      >(
        `UPDATE payment SET status = "expired"
         WHERE status = "pending"
           AND expiresAt IS NOT NONE
           AND expiresAt <= time::now()
         RETURN id, companyId, systemId, subscriptionId, kind, amount, currency;`,
      );

      const payments = expired[0] ?? [];
      if (payments.length === 0) return;

      console.log(`[expiry] Marked ${payments.length} expired payments.`);

      for (const payment of payments) {
        // Batch: owner info + system info + expire credit purchase + clear guards (§7.2)
        const result = await db.query<
          [{ id: string; name: string }[], { name: string; slug: string }[]]
        >(
          `LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
           SELECT id, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
           SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
           UPDATE credit_purchase SET status = "expired"
             WHERE subscriptionId = $subId AND status = "pending";
           UPDATE $subId SET
            retryPaymentInProgress = false,
            autoRechargeInProgress = false;`,
          {
            companyId: rid(String(payment.companyId)),
            systemId: rid(String(payment.systemId)),
            subId: rid(String(payment.subscriptionId)),
          },
        );

        const owner = result[0]?.[0];
        const systemInfo = result[1]?.[0];
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
              ctaUrl: `/billing?system=${systemSlug}`,
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
