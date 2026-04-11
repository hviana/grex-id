import type { Profile } from "./profile";

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified?: boolean;
  profile: Profile;
  roles: string[];
  twoFactorEnabled: boolean;
  oauthProvider?: string;
  stayLoggedIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserCredentials {
  email: string;
  phone?: string;
  password: string;
}
