export interface TemplateResult {
  body: string;
  title?: string;
}

// Static per-channel template function — receives only (locale, data).
export type TemplateFunction<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (
  locale: string,
  data: T,
) => Promise<TemplateResult>;

// Dynamic template builder — receives full dispatch context including the
// target channel. Called once per channel iteration.
export type TemplateBuilder = (
  senders: string[],
  recipients: string[],
  templateData: Record<string, unknown>,
  channel: string,
) => Promise<TemplateResult>;

// Unified publish payload for `publish("send_communication", …)` (§15.1).
export interface CommunicationPayload {
  channels?: string[];
  senders?: string[];
  recipients: string[];
  template: string | TemplateBuilder;
  templateData: Record<string, unknown>;
}

export interface ChannelDispatchResult {
  delivered: boolean;
  reason?:
    | "no-recipients"
    | "template-missing"
    | "provider-error"
    | "all-channels-exhausted"
    | string;
}

// Shared tenant display fields placed inside `templateData` (§15.5).
export interface TemplateTenantContext {
  actorName?: string;
  companyName?: string;
  systemName?: string;
}
