import Core from "../../utils/Core.ts";
import { getTemplate } from "../../module-registry.ts";
import type { HandlerFn } from "../worker.ts";

export const sendSms: HandlerFn = async (payload) => {
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

  // Resolve template from registry
  const templateFn = getTemplate(template);
  let body: string | undefined;

  if (templateFn) {
    const result = templateFn(locale, templateData);
    body = result.body;
  }

  // TODO: Call external SMS API (Twilio, etc.)
  // configured via setting "communication.sms.provider"
  console.log(
    `[sms] Sending "${template}" to ${
      recipients.join(", ")
    } (locale: ${locale}, body: ${body ?? "none"})`,
  );
};
