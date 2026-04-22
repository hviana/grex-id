import Core from "../../utils/Core.ts";
import {
  channelHandlerName,
  getTemplate,
  getTemplateBuilder,
  hasChannel,
} from "../../module-registry.ts";
import { publish } from "../publisher.ts";
import { getDb, rid } from "../../db/connection.ts";
import type { HandlerFn } from "../worker.ts";
import type {
  TemplateBuilder,
  TemplateResult,
} from "@/src/contracts/communication";

const CHANNEL = "sms";

function isRecordId(value: string): boolean {
  return /^[a-z_][a-z0-9_]*:[^:\s]+$/i.test(value);
}

async function resolveRecipients(raw: string[]): Promise<string[]> {
  const resolved: string[] = [];
  const db = await getDb();
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!isRecordId(entry)) {
      resolved.push(entry);
      continue;
    }
    const table = entry.split(":")[0];
    if (table !== "user" && table !== "lead") continue;
    // SMS delivery uses the dedicated "sms" entity_channel type, not "phone".
    // A phone number may refuse SMS (VoIP / landline), and a text-only line
    // is not suitable for voice calls — the two are distinct channels.
    const result = await db.query<[{ value: string }[]]>(
      `LET $owner = (SELECT channels FROM ${table} WHERE id = $ownerId)[0];
       IF $owner = NONE { RETURN []; };
       SELECT value FROM entity_channel
       WHERE id IN $owner.channels AND type = $type AND verified = true
       ORDER BY createdAt ASC;`,
      { ownerId: rid(entry), type: CHANNEL },
    );
    for (const row of result[0] ?? []) {
      if (row.value) resolved.push(row.value);
    }
  }
  return [...new Set(resolved)];
}

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
  const core = Core.getInstance();

  const rawRecipients = (payload.recipients as string[] | undefined) ?? [];
  const template = payload.template as string | TemplateBuilder;
  const templateData =
    (payload.templateData as Record<string, unknown> | undefined) ?? {};

  let locale = templateData.locale as string | undefined;
  if (!locale) {
    const systemSlug = templateData.systemSlug as string | undefined;
    if (systemSlug) {
      const system = await core.getSystemBySlug(systemSlug);
      locale = system?.defaultLocale ?? undefined;
    }
  }
  locale ??= "en";

  const payloadSenders = payload.senders as string[] | undefined;
  const senders = payloadSenders && payloadSenders.length > 0
    ? payloadSenders
    : JSON.parse(
      (await core.getSetting("communication.sms.senders")) ?? "[]",
    ) as string[];

  const recipients = await resolveRecipients(rawRecipients);
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

  const provider = (await core.getSetting("communication.sms.provider")) ?? "";
  console.log(
    `[${CHANNEL}] Would send "${
      typeof template === "string" ? template : "builder"
    }" via provider="${provider}" to ${
      recipients.join(", ")
    } (locale: ${locale}, body: ${rendered.body ?? "none"})`,
  );
};
