export interface Lead {
  id: string;
  name: string;
  profileId: string;
  channelIds: string[];
  tenantIds: string[];
  ownerId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}
