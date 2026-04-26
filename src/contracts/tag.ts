export interface Tag {
  id: string;
  name: string;
  color: string;
  tenantIds: string[]; // references company-system tenant rows
  createdAt: string;
}
