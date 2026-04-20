export interface ConnectedApp {
  id: string;
  name: string;
  companyId: string;
  systemId: string;
  permissions: string[];
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  apiTokenId?: string; // linked api_token for revocation cascade
  createdAt: string;
}
