import Core from "../../utils/Core";
import type { HandlerFn } from "../worker";
import type { TemplateFunction } from "@/src/contracts/communication";

const templateRegistry: Record<string, TemplateFunction> = {
  // SMS templates can be registered here as they are created
};

export const sendSms: HandlerFn = async (payload) => {
  const core = Core.getInstance();

  const recipients = payload.recipients as string[];
  const template = payload.template as string;
  const templateData = payload.templateData as Record<string, string>;
  const systemSlug = payload.systemSlug as string | undefined;

  // Resolve locale: payload > system default > hardcoded fallback
  let locale = payload.locale as string | undefined;
  if (!locale && systemSlug) {
    const system = core.getSystemBySlug(systemSlug);
    locale = system?.defaultLocale ?? undefined;
  }
  locale ??= "en";

  // Resolve template
  const templateFn = templateRegistry[template];
  let body: string | undefined;

  if (templateFn) {
    const result = templateFn(locale, templateData);
    body = result.body;
  }

  // TODO: Call external SMS API (Twilio, etc.)
  // configured via core_setting "communication.sms.provider"
  console.log(
    `[sms] Sending "${template}" to ${
      recipients.join(", ")
    } (locale: ${locale}, body: ${body ?? "none"})`,
  );
};
