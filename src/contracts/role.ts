export interface Role {
  id: string;
  name: string;
  tenantId: string; // references system-only tenant row
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}
