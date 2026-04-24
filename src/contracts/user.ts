import type { EntityChannel } from "./entity-channel.ts";
import type { Profile } from "./profile.ts";

export interface User {
  id: string;
  profile: Profile;
  channels: EntityChannel[];
  roles: string[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  /**
   * Temporary secret staged by `POST /api/auth/two-factor action:setup-totp`
   * and promoted to `twoFactorSecret` by the verify handler when the user
   * clicks the `auth.action.twoFactorEnable` confirmation link (§8.8).
   */
  pendingTwoFactorSecret?: string;
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
