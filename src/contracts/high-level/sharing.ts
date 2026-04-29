// ============================================================================
// Sharing/access types — consumed by RemoveAccessModal.
// Represents the API response shape for entity share/access entries.
// ============================================================================

export interface ShareEntry {
  id: string;
  tenantId?: string;
  tenantLabel: string;
  permission?: string;
  isSelected: boolean;
}
