export type RecoveryChannelType = "email" | "phone";

export interface RecoveryChannel {
  id: string;
  userId: string;
  type: RecoveryChannelType;
  value: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}
