import {
  registerCache,
  registerChannel,
  registerHandler,
  registerJob,
  registerTemplate,
} from "./module-registry.ts";
import { sendCommunication } from "./event-queue/handlers/send-communication.ts";
import { sendEmail } from "./event-queue/handlers/send-email.ts";
import { sendSms } from "./event-queue/handlers/send-sms.ts";
import { processPayment } from "./event-queue/handlers/process-payment.ts";
import { handleAutoRecharge } from "./event-queue/handlers/auto-recharge.ts";
import { resolveAsyncPayment } from "./event-queue/handlers/resolve-async-payment.ts";
import { startRecurringBilling } from "./jobs/recurring-billing.ts";
import { startTokenCleanup } from "./jobs/token-cleanup.ts";
import { startPaymentExpiry } from "./jobs/expire-pending-payments.ts";
import { humanConfirmationEmailTemplate } from "./utils/communication/templates/email/human-confirmation.ts";
import { notificationEmailTemplate } from "./utils/communication/templates/email/notification.ts";
import { humanConfirmationSmsTemplate } from "./utils/communication/templates/sms/human-confirmation.ts";
import { notificationSmsTemplate } from "./utils/communication/templates/sms/notification.ts";
import { loadCoreData } from "./utils/Core.ts";
import { loadFrontCoreData } from "./utils/FrontCore.ts";
import { loadJwtSecret } from "./utils/token.ts";
import { loadFileAccessData } from "./utils/file-access-cache.ts";
import FileCacheManager from "./utils/file-cache.ts";
import { assertServerOnly } from "./utils/server-only.ts";

assertServerOnly("core-register");

export function registerCore(): void {
  // Caches
  registerCache("core", "data", loadCoreData);
  registerCache("core", "front-data", loadFrontCoreData);
  registerCache("core", "jwt-secret", loadJwtSecret);
  registerCache("core", "file-access", loadFileAccessData);
  // The actor-validity cache (§8.11) is sharded per tenant and registers
  // partitions lazily on first access — no boot-time registration here.

  // Event handlers — one name is both the event and the handler function key
  registerHandler("send_communication", sendCommunication);
  registerHandler("send_email", sendEmail);
  registerHandler("send_sms", sendSms);
  registerHandler("process_payment", processPayment);
  registerHandler("auto_recharge", handleAutoRecharge);
  registerHandler("resolve_async_payment", resolveAsyncPayment);

  // Communication channels — the dispatcher routes to `send_<channel>`.
  // Phone (voice) is a distinct channel and is not registered by core; a
  // framework providing voice calls would register it separately.
  registerChannel("email");
  registerChannel("sms");

  // Jobs
  registerJob("recurring-billing", startRecurringBilling);
  registerJob("token-cleanup", startTokenCleanup);
  registerJob("expire-pending-payments", startPaymentExpiry);

  // Unified communication templates — one per (channel, template).
  registerTemplate(
    "email",
    "human-confirmation",
    humanConfirmationEmailTemplate,
  );
  registerTemplate("email", "notification", notificationEmailTemplate);
  registerTemplate("sms", "human-confirmation", humanConfirmationSmsTemplate);
  registerTemplate("sms", "notification", notificationSmsTemplate);

  // File cache singleton
  FileCacheManager.getInstance();
}
