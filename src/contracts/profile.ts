import type { EntityChannel } from "./entity-channel.ts";

export interface Profile {
  id: string;
  name: string;
  avatarUri?: string;
  age?: number;
  locale?: string;
  channels: EntityChannel[];
  createdAt: string;
  updatedAt: string;
}
