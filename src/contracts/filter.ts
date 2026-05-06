export interface Folter {
  id: string;
  tenantIds: string[];
  name: string;
  applicableTo: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
