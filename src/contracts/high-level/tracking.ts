// ============================================================================
// Data-tracking consent contracts — consumed by useDataTrackingConsent hook
// and CookieConsent component.
// ============================================================================

export interface DataTrackingConsentState {
  /** True only when the cookie equals "accepted". */
  accepted: boolean;
  /** True once the user has clicked either button (cookie present). */
  decided: boolean;
  /** Resolved list from `front.dataTracking.trackedCharacteristics`. */
  trackedCharacteristics: string[];
}
