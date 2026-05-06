export interface Role {
  id: string;
  name: string;
  tenantIds: string[]; // references system-only tenant rows
  granular: boolean;
  createdAt: string;
  updatedAt?: string;
}
