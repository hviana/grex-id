import Core from "../../utils/Core.ts";
import { verificationTemplate } from "../../utils/communication/templates/verification.ts";
import { passwordResetTemplate } from "../../utils/communication/templates/password-reset.ts";
import { leadUpdateVerificationTemplate } from "../../utils/communication/templates/lead-update-verification.ts";
import { paymentSuccessTemplate } from "../../utils/communication/templates/payment-success.ts";
import { paymentFailureTemplate } from "../../utils/communication/templates/payment-failure.ts";
import { autoRechargeTemplate } from "../../utils/communication/templates/auto-recharge.ts";
import { insufficientCreditTemplate } from "../../utils/communication/templates/insufficient-credit.ts";
import { tenantInviteTemplate } from "../../utils/communication/templates/tenant-invite.ts";
import { recoveryVerifyTemplate } from "../../utils/communication/templates/recovery-verify.ts";
import { recoveryChannelResetTemplate } from "../../utils/communication/templates/recovery-channel-reset.ts";
import type { HandlerFn } from "../worker.ts";
import type { TemplateFunction } from "@/src/contracts/communication";

const templateRegistry: Record<string, TemplateFunction> = {
  verification: verificationTemplate as unknown as TemplateFunction,
  "password-reset": passwordResetTemplate as unknown as TemplateFunction,
  "lead-update-verification":
    leadUpdateVerificationTemplate as unknown as TemplateFunction,
  "payment-success": paymentSuccessTemplate as unknown as TemplateFunction,
  "payment-failure": paymentFailureTemplate as unknown as TemplateFunction,
  "auto-recharge": autoRechargeTemplate as unknown as TemplateFunction,
  "insufficient-credit":
    insufficientCreditTemplate as unknown as TemplateFunction,
  "tenant-invite": tenantInviteTemplate as unknown as TemplateFunction,
  "recovery-verify": recoveryVerifyTemplate as unknown as TemplateFunction,
  "recovery-channel-reset":
    recoveryChannelResetTemplate as unknown as TemplateFunction,
};

export const sendEmail: HandlerFn = async (payload) => {
  const core = Core.getInstance();

  const recipients = payload.recipients as string[];
  const template = payload.template as string;
  const templateData = payload.templateData as Record<string, string>;
  const systemSlug = payload.systemSlug as string | undefined;

  // Resolve locale: payload > system default > hardcoded fallback
  let locale = payload.locale as string | undefined;
  if (!locale && systemSlug) {
    const system = await core.getSystemBySlug(systemSlug);
    locale = system?.defaultLocale ?? undefined;
  }
  locale ??= "en";

  // Resolve senders: payload > Core setting
  const senders = (payload.senders as string[] | undefined) ??
    JSON.parse(
      (await core.getSetting("communication.email.senders")) ?? "[]",
    ) as string[];

  // Resolve template
  const templateFn = templateRegistry[template];
  let subject: string | undefined;
  let body: string | undefined;

  if (templateFn) {
    const result = templateFn(locale, templateData);
    subject = result.title;
    body = result.body;
  }

  // Resolve Mailgun configuration from Core settings
  const mailgunApiKey = await core.getSetting(
    "communication.email.mailgun_apikey",
  );
  const mailgunUrl = await core.getSetting("communication.email.mailgun_url");
  const mailgunFrom =
    (await core.getSetting("communication.email.mailgun_from")) ?? senders[0];

  if (!mailgunApiKey || !mailgunUrl) {
    throw new Error(
      "Mailgun not configured — missing communication.email.mailgun_apikey or communication.email.mailgun_url core settings",
    );
  }

  const from = mailgunFrom ?? senders[0] ?? "noreply@localhost";

  for (const recipient of recipients) {
    const form = new FormData();
    form.append("from", from);
    form.append("to", recipient);
    if (subject) form.append("subject", subject);
    if (body) form.append("html", body);

    const response = await fetch(mailgunUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${mailgunApiKey}`)}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[email] Mailgun error ${response.status} for ${recipient}: ${errorText}`,
      );
    }

    console.log(
      `[email] Sent "${template}" to ${recipient} (locale: ${locale})`,
    );
  }
};
