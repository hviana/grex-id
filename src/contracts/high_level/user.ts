import type { Profile } from "../profile";
import type { EntityChannel } from "../entity-channel";
import type { ResourceLimit } from "../resource-limit";

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
