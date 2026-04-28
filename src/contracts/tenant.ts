export interface Tenant {
  id?: string;
  actorId?: string;
  companyId?: string;
  systemId?: string;
  isOwner?: boolean;
  groupIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}
