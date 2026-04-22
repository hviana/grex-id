import type { EntityChannel } from "./entity-channel.ts";

export interface Profile {
  id: string;
  name: string;
  avatarUri?: string;
  age?: number;
  locale?: string;
  recovery_channels: EntityChannel[];
  createdAt: string;
  updatedAt: string;
}
