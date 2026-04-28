export interface SharedRecord {
  id: string;
  recordId: string;
  ownerTenantId: string;
  accessesTenantIds: string[];
  permissions: string[];
}
