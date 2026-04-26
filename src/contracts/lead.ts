import type { EntityChannel } from "./entity-channel.ts";
import type { Profile } from "./profile.ts";

export interface Lead {
  id: string;
  name: string;
  profileId: Profile;
  channelIds: EntityChannel[];
  tenantIds: string[];
  ownerId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}
