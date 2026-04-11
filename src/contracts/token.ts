export interface ApiToken {
  id: string;
  userId: string;
  companyId: string;
  systemId: string;
  name: string;
  description?: string;
  tokenHash: string;
  permissions: string[];
  monthlySpendLimit?: number;
  expiresAt?: string;
  createdAt: string;
}
