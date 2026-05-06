export interface Lead {
  id: string;
  name: string;
  profileId: string;
  channelIds: string[];
  tenantIds: string[];
  ownerIds: string;
  tagIds: string[];
  acceptsCommunication: boolean;
  createdAt: string;
  updatedAt: string;
}
