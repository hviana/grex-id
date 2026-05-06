import type { EntityChannel } from "../entity-channel";

// ============================================================================
// Display-oriented lead data — used by LeadView.
// ============================================================================

export interface LeadViewData {
  id?: string;
  name?: string;
  profileId?: {
    name: string;
    avatarUri?: string;
  };
  channelIds?: EntityChannel[];
  tagIds?: string[];
  ownerIds?: {
    id: string;
    name: string;
  }[];
  interactions?: number;
  acceptsCommunication: boolean;
  createdAt: string;
  [key: string]: unknown;
}
