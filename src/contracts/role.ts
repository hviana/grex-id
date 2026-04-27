export interface Role {
  id: string;
  name: string;
  tenantIds: string[]; // references system-only tenant rows
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt?: string;
}
