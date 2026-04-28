export interface Profile {
  id: string;
  name: string;
  avatarUri?: string;
  dateOfBirth?: string;
  locale?: string;
  recoveryChannelIds: string[];
  createdAt: string;
  updatedAt: string;
}
