import type { EntityChannel } from "./entity-channel.ts";

export interface Profile {
  id: string;
  name: string;
  avatarUri?: string;
  dateOfBirth?: string;
  locale?: string;
  recoveryChannelIds: EntityChannel[];
  createdAt: string;
  updatedAt: string;
}
