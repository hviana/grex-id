import Core from "../../utils/Core.ts";
import {
  channelHandlerName,
  getTemplate,
  getTemplateBuilder,
  hasChannel,
} from "../../module-registry.ts";
import { publish } from "../publisher.ts";
import { resolveChannelRecipients } from "../../db/queries/communications.ts";
import type { HandlerFn } from "@/src/contracts/high-level/event-queue";
import type {
  TemplateBuilder,
  TemplateResult,
} from "@/src/contracts/high-level/communication";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("send-email");

const CHANNEL = "email";

async function cascade(
  payload: Record<string, unknown>,
  reason: string,
): Promise<void> {
  const fallback = (payload.channelFallback as string[] | undefined) ?? [];
  const next = fallback.find((c) => hasChannel(c));
  if (!next) {
    console.warn(
      `[${CHANNEL}] channel chain exhausted after ${CHANNEL}: ${reason}`,
    );
    return;
  }
  const nextFallback = fallback.slice(fallback.indexOf(next) + 1);
  await publish(channelHandlerName(next), {
    ...payload,
    channel: next,
    channelFallback: nextFallback,
  });
  console.log(`[${CHANNEL}] cascading to "${next}" after ${reason}`);
}

export const sendEmail: HandlerFn = async (payload) => {
  const core = Core.getInstance();

  const rawRecipients = (payload.recipients as string[] | undefined) ?? [];
  const template = payload.template as string | TemplateBuilder;
  const templateData =
    (payload.templateData as Record<string, unknown> | undefined) ?? {};

  // ── locale resolution ─────────────────────────────────
  let locale = templateData.locale as string | undefined;
  if (!locale) {
    const systemSlug = templateData.systemSlug as string | undefined;
    if (systemSlug) {
      const system = await core.getSystemBySlug(systemSlug);
      locale = system?.defaultLocale ?? undefined;
    }
  }
  locale ??= "en";

  // ── sender resolution ─────────────────────────────────
  const payloadSenders = payload.senders as string[] | undefined;
  const senders = payloadSenders && payloadSenders.length > 0
    ? payloadSenders
    : JSON.parse(
      (await core.getSetting("communication.email.senders")) ?? "[]",
    ) as string[];
  // ── recipient resolution ─────────────────────────────
  const allowUnverified = Boolean(payload.allowUnverified);
  const recipients = await resolveChannelRecipients(
    rawRecipients,
    CHANNEL,
    allowUnverified ? { includeUnverified: true } : undefined,
  );
  if (recipients.length === 0) {
    await cascade(payload, "no-recipients");
    return;
  }

  // ── template rendering ────────────────────────────────
  let rendered: TemplateResult | undefined;

  if (typeof template === "function") {
    rendered = await template(senders, recipients, templateData, CHANNEL);
  } else if (typeof template === "string") {
    const staticFn = getTemplate(CHANNEL, template);
    if (staticFn) {
      rendered = await staticFn(locale, templateData);
    } else {
      const builder = getTemplateBuilder(template);
      if (builder) {
        rendered = await builder(senders, recipients, templateData, CHANNEL);
      }
    }
  }

  if (!rendered) {
    await cascade(payload, "template-missing");
    return;
  }

  const mailgunApiKey = await core.getSetting(
    "communication.email.mailgun_apikey",
  );
  const mailgunUrl = await core.getSetting("communication.email.mailgun_url");
  const mailgunFrom =
    (await core.getSetting("communication.email.mailgun_from")) ??
      senders[0];

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
    if (rendered.title) form.append("subject", rendered.title);
    if (rendered.body) form.append("html", rendered.body);

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
        `[${CHANNEL}] Mailgun error ${response.status} for ${recipient}: ${errorText}`,
      );
    }

    console.log(
      `[${CHANNEL}] Sent "${
        typeof template === "string" ? template : "builder"
      }" to ${recipient} (locale: ${locale})`,
    );
  }
};
