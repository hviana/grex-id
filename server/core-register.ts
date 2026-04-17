import {
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
import type { TemplateFunction } from "../src/contracts/communication.ts";

export function registerCore(): void {
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
  registerTemplate(
    "verification",
    verificationTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "password-reset",
    passwordResetTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "lead-update-verification",
    leadUpdateVerificationTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "payment-success",
    paymentSuccessTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "payment-failure",
    paymentFailureTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "auto-recharge",
    autoRechargeTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "insufficient-credit",
    insufficientCreditTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "tenant-invite",
    tenantInviteTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "recovery-verify",
    recoveryVerifyTemplate as unknown as TemplateFunction,
  );
  registerTemplate(
    "recovery-channel-reset",
    recoveryChannelResetTemplate as unknown as TemplateFunction,
  );
}
