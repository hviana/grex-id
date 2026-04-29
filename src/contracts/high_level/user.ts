import type { Profile } from "../profile";
import type { EntityChannel } from "../entity-channel";
import type { ResourceLimit } from "../resource-limit";
import type { ResourceLimitsData } from "./resource-limits";

// ============================================================================
// Resolved user types — used by TenantProvider and server queries.
// ============================================================================

/**
 * FETCH-resolved User with FK fields replaced by their resolved objects.
 * Used by the frontend via TenantProvider and by server queries that
 * FETCH profileId, channelIds, resourceLimitId.
 */
export interface UserResolved {
  id: string;
  passwordHash: string;
  profile?: Profile;
  channels?: EntityChannel[];
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  pendingTwoFactorSecret?: string;
  stayLoggedIn: boolean;
  resourceLimit?: ResourceLimit;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Auth input contracts
// ============================================================================

export interface UserCredentials {
  identifier: string;
  password: string;
}

// ============================================================================
// Display-oriented user data — used by UserView and UsersPage.
// ============================================================================

export interface UserViewData {
  id: string;
  profileId?: {
    name: string;
    avatarUri?: string;
  };
  channelIds?: {
    id: string;
    type: string;
    value: string;
    verified: boolean;
  }[];
  contextRoles?: string[];
  resourceLimitId?: ResourceLimitsData | null;
  createdAt: string;
  [key: string]: unknown;
}
