// ============================================================================
// Communication template layout banner types
// ============================================================================

/** Banner data for email layouts (server/utils/communication/templates/email/layout.ts). */
export interface TenantBanner {
  actorName?: string;
  companyName?: string;
  systemName?: string;
}

/** Banner data for SMS layouts (server/utils/communication/templates/sms/layout.ts). */
export interface SmsLayoutBanner {
  actorName?: string;
  companyName?: string;
  systemName?: string;
}
