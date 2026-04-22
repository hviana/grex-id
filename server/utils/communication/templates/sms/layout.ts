import { assertServerOnly } from "../../../server-only.ts";
assertServerOnly("layout");
export interface SmsLayoutBanner {
  actorName?: string;
  companyName?: string;
  systemName?: string;
}

export function smsLayout(body: string, banner?: SmsLayoutBanner): string {
  const parts: string[] = [];
  if (banner?.systemName) parts.push(`[${banner.systemName}]`);
  if (banner?.companyName) parts.push(banner.companyName);
  if (banner?.actorName) parts.push(banner.actorName);
  const header = parts.length > 0 ? parts.join(" · ") + " — " : "";
  return `${header}${body}`.trim();
}
