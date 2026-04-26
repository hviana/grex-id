export interface ConnectedApp {
  id: string;
  name: string;
  tenantId: string; // references app actor + company + system tenant row
  roles: string[];
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  apiTokenId?: string; // linked api_token for revocation cascade
  createdAt: string;
}
