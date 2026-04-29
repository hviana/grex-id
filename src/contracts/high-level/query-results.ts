// ============================================================================
// Query result types for tenant, entity-channel, token, user, and usage queries.
// These are returned by server/db/queries/* modules and consumed by routes/utils.
// ============================================================================

/** Tenant row from server/db/queries/tenants.ts. */
export interface TenantRow {
  id: string;
  companyId: string;
  systemId: string;
  roleIds?: string[];
}

/** Owner kind for entity-channel query-layer operations (server/db/queries/entity-channels.ts). */
export type EntityChannelOwnerKind = "user" | "lead";

/** Per-row result of findChannelOwners (server/db/queries/entity-channels.ts). */
export interface ChannelOwnerMatch {
  ownerId: string;
  channelId: string;
  type: string;
  value: string;
  verified: boolean;
}

/** Token cleanup result (server/db/queries/tokens.ts). */
export interface TokenCleanupResult {
  tokensDeleted: number;
}

/** Invite-existing-user result (server/db/queries/users.ts). */
export interface InviteExistingUserResult {
  systemName: string;
  companyName: string;
  inviterName: string;
  inviteeName: string;
}

/** Credit expense row for core admin usage view (server/db/queries/usage.ts). */
export interface CoreCreditExpenseRow {
  resourceKey: string;
  totalAmount: number;
  totalCount: number;
}

/** Tenant usage config returned by usage queries (server/db/queries/usage.ts). */
export interface TenantUsageConfig {
  systemSlug: string | null;
  subscriptionStorageLimit: number | null;
  subscriptionCacheLimit: number | null;
  voucherStorageModifier: number;
  voucherCacheModifier: number;
  creditExpenses: CoreCreditExpenseRow[];
}
