export interface ConnectedApp {
  id: string;
  name: string;
  tenantIds: string[]; // references app actor + company + system tenant rows
  roles: string[];
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  apiTokenId?: string; // linked api_token for revocation cascade
  createdAt: string;
}
