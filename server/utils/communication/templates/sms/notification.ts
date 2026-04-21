import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";
import { smsLayout } from "./layout.ts";

interface NotificationData {
  eventKey: string;
  occurredAt: string;
  actorName?: string;
  companyName?: string;
  systemName?: string;
  resources?: string[];
  value?: { amount: number; currency: string } | number;
  invoiceUrl?: string;
  ctaKey?: string;
  ctaUrl?: string;
}

export async function notificationSmsTemplate(
  locale: string,
  data: NotificationData,
): Promise<TemplateResult> {
  const eventName = t(data.eventKey, locale);
  const parts: string[] = [eventName];
  if (data.resources && data.resources.length > 0) {
    parts.push(data.resources.map((k) => t(k, locale)).join(", "));
  }
  if (data.value !== undefined) {
    const amountCents = typeof data.value === "number"
      ? data.value
      : data.value.amount;
    const currency = typeof data.value === "number"
      ? "USD"
      : data.value.currency;
    parts.push(`${currency} ${(amountCents / 100).toFixed(2)}`);
  }
  if (data.ctaUrl) parts.push(data.ctaUrl);

  const body = parts.join(" · ");

  return {
    title: eventName,
    body: smsLayout(body, {
      actorName: data.actorName,
      companyName: data.companyName,
      systemName: data.systemName,
    }),
  };
}
