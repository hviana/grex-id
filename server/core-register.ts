import {
  registerCache,
  registerEventHandler,
  registerHandlerFunction,
  registerJob,
  registerTemplate,
} from "./module-registry.ts";
import { sendEmail } from "./event-queue/handlers/send-email.ts";
import { sendSms } from "./event-queue/handlers/send-sms.ts";
import { processPayment } from "./event-queue/handlers/process-payment.ts";
import { handleAutoRecharge } from "./event-queue/handlers/auto-recharge.ts";
import { startRecurringBilling } from "./jobs/recurring-billing.ts";
import { startTokenCleanup } from "./jobs/token-cleanup.ts";
import { verificationTemplate } from "./utils/communication/templates/verification.ts";
import { passwordResetTemplate } from "./utils/communication/templates/password-reset.ts";
import { leadUpdateVerificationTemplate } from "./utils/communication/templates/lead-update-verification.ts";
import { paymentSuccessTemplate } from "./utils/communication/templates/payment-success.ts";
import { paymentFailureTemplate } from "./utils/communication/templates/payment-failure.ts";
import { autoRechargeTemplate } from "./utils/communication/templates/auto-recharge.ts";
import { insufficientCreditTemplate } from "./utils/communication/templates/insufficient-credit.ts";
import { tenantInviteTemplate } from "./utils/communication/templates/tenant-invite.ts";
import { recoveryVerifyTemplate } from "./utils/communication/templates/recovery-verify.ts";
import { recoveryChannelResetTemplate } from "./utils/communication/templates/recovery-channel-reset.ts";
import { loadCoreData } from "./utils/Core.ts";
import { loadFrontCoreData } from "./utils/FrontCore.ts";
import { loadJwtSecret } from "./utils/token.ts";
import FileCacheManager from "./utils/file-cache.ts";

export function registerCore(): void {
  // Caches
  registerCache("core", "data", loadCoreData);
  registerCache("core", "front-data", loadFrontCoreData);
  registerCache("core", "jwt-secret", loadJwtSecret);

  // Event handlers
  registerEventHandler("SEND_EMAIL", "send_email");
  registerHandlerFunction("send_email", sendEmail);

  registerEventHandler("SEND_SMS", "send_sms");
  registerHandlerFunction("send_sms", sendSms);

  registerEventHandler("PAYMENT_DUE", "process_payment");
  registerHandlerFunction("process_payment", processPayment);

  registerEventHandler("TRIGGER_AUTO_RECHARGE", "auto_recharge");
  registerHandlerFunction("auto_recharge", handleAutoRecharge);

  // Jobs
  registerJob("recurring-billing", startRecurringBilling);
  registerJob("token-cleanup", startTokenCleanup);

  // Communication templates
  registerTemplate("verification", verificationTemplate);
  registerTemplate("password-reset", passwordResetTemplate);
  registerTemplate("lead-update-verification", leadUpdateVerificationTemplate);
  registerTemplate("payment-success", paymentSuccessTemplate);
  registerTemplate("payment-failure", paymentFailureTemplate);
  registerTemplate("auto-recharge", autoRechargeTemplate);
  registerTemplate("insufficient-credit", insufficientCreditTemplate);
  registerTemplate("tenant-invite", tenantInviteTemplate);
  registerTemplate("recovery-verify", recoveryVerifyTemplate);
  registerTemplate("recovery-channel-reset", recoveryChannelResetTemplate);

  // File cache singleton
  FileCacheManager.getInstance();
}
