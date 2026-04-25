import type { EntityChannel } from "./entity-channel.ts";
import type { Profile } from "./profile.ts";

export interface Lead {
  id: string;
  name: string;
  profileId: Profile;
  channelIds: EntityChannel[];
  companyIds: string[];
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadCompanySystem {
  id: string;
  leadId: string;
  companyId: string;
  systemId: string;
  ownerId?: string;
  createdAt: string;
}
