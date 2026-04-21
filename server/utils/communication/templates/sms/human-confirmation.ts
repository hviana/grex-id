import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { smsLayout } from "./layout.ts";

interface HumanConfirmationData {
  actionKey: string;
  confirmationLink: string;
  occurredAt: string;
  actorName?: string;
  companyName?: string;
  systemName?: string;
  expiryMinutes?: string | number;
}

export async function humanConfirmationSmsTemplate(
  locale: string,
  data: HumanConfirmationData,
): Promise<TemplateResult> {
  const actionName = t(data.actionKey, locale);
  const minutes = String(data.expiryMinutes ?? "15");
  const body = t("templates.humanConfirmation.sms", locale, {
    action: actionName,
    link: data.confirmationLink,
    minutes,
  });

  return {
    title: actionName,
    body: smsLayout(body, {
      actorName: data.actorName,
      companyName: data.companyName,
      systemName: data.systemName,
    }),
  };
}
