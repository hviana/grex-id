export interface Setting {
  id: string;
  key: string;
  value: string;
  description: string;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}
