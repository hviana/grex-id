import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/high-level/communication";
import type { HumanConfirmationTemplateData } from "@/src/contracts/high-level/communication-templates";
import { smsLayout } from "./layout.ts";
import { assertServerOnly } from "../../../server-only.ts";

assertServerOnly("human-confirmation");

export async function humanConfirmationSmsTemplate(
  locale: string,
  data: HumanConfirmationTemplateData,
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
