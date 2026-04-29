// ============================================================================
// Settings display types — consumed by SettingsEditor.
// Represents the API response shape from GET /api/core/settings
// and GET /api/core/front-settings.
// ============================================================================

export interface SettingItem {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedAt?: string;
}
