import { assertServerOnly } from "../../../server-only.ts";
import type { SmsLayoutBanner } from "@/src/contracts/high-level/communication-templates";
assertServerOnly("layout");

export type { SmsLayoutBanner };

export function smsLayout(body: string, banner?: SmsLayoutBanner): string {
  const parts: string[] = [];
  if (banner?.systemName) parts.push(`[${banner.systemName}]`);
  if (banner?.companyName) parts.push(banner.companyName);
  if (banner?.actorName) parts.push(banner.actorName);
  const header = parts.length > 0 ? parts.join(" · ") + " — " : "";
  return `${header}${body}`.trim();
}
