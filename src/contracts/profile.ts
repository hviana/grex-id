import type { RecoveryChannel } from "./recovery-channel.ts";

export interface Profile {
  id: string;
  name: string;
  avatarUri?: string;
  age?: number;
  locale?: string;
  recoveryChannels: RecoveryChannel[];
  createdAt: string;
  updatedAt: string;
}
