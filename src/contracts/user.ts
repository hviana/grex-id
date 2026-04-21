import type { Profile } from "./profile.ts";

export interface User {
  id: string;
  profile: Profile;
  roles: string[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  oauthProvider?: string;
  stayLoggedIn: boolean;
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
