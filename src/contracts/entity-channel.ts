export type EntityChannelOwnerType = "user" | "lead";

export interface EntityChannel {
  id: string;
  ownerId: string;
  ownerType: EntityChannelOwnerType;
  type: string;
  value: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}
