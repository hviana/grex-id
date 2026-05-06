export interface TenantData {
  id: string;
  tenantIds: string[];
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
