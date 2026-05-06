import "server-only";

import { get } from "../../utils/instrumentation-cache.ts";
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

const CHANNEL = "sms";

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

export const sendSms: HandlerFn = async (payload) => {
  const rawRecipients = (payload.recipients as string[] | undefined) ?? [];
  const template = payload.template as string | TemplateBuilder;
  const templateData =
    (payload.templateData as Record<string, unknown> | undefined) ?? {};

  let locale = templateData.locale as string | undefined;
  if (!locale) {
    const systemSlug = templateData.systemSlug as string | undefined;
    if (systemSlug) {
      const coreData = await get(undefined, "core-data") as any;
      const system = coreData?.systemsBySlug?.[systemSlug];
      locale = system?.defaultLocale ?? undefined;
    }
  }
  locale ??= "en";

  const payloadSenders = payload.senders as string[] | undefined;
  const senders = payloadSenders && payloadSenders.length > 0
    ? payloadSenders
    : ((await get(undefined, "setting.communication.sms.senders")) as
      | string[]
      | undefined) ?? [];

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

  const provider =
    (await get(undefined, "setting.communication.sms.provider")) ?? "";
  console.log(
    `[${CHANNEL}] Would send "${
      typeof template === "string" ? template : "builder"
    }" via provider="${provider}" to ${
      recipients.join(", ")
    } (locale: ${locale}, body: ${rendered.body ?? "none"})`,
  );
};
