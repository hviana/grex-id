export interface Tag {
  id: string;
  name: string;
  color: string;
  tenantId: string; // references company-system tenant row
  createdAt: string;
}
