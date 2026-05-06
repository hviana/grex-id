export interface SharedRecord {
  id: string;
  recordId: string;
  ownerTenantIds: string[];
  accessesTenantIds: string[];
  permissions: string[];
  fields: string[];
}
