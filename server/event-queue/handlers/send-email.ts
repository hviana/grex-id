import Core from "../../utils/Core.ts";
import { getTemplate } from "../../module-registry.ts";
import type { HandlerFn } from "../worker.ts";

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

  // Resolve template from registry
  const templateFn = getTemplate(template);
  let subject: string | undefined;
  let body: string | undefined;

  if (templateFn) {
    const result = await templateFn(locale, templateData);
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
