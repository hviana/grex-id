export interface ApiToken {
  id: string;
  tenantIds: string[];
  name: string;
  description?: string;
  actorType: "app" | "token";
  resourceLimitId: string;
  neverExpires?: boolean;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}
