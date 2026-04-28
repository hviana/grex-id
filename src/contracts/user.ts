export interface User {
  id: string;
  passwordHash: string;
  profileId: string;
  channelIds: string[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  pendingTwoFactorSecret?: string;
  stayLoggedIn: boolean;
  resourceLimitId: string;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubmittedChannel {
  type: string;
  value: string;
}

export interface UserCredentials {
  identifier: string;
  password: string;
}
