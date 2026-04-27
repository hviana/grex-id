/**
 * Resource limit composable (§3.3). Referenced by api_token, user, plan,
 * and voucher via resourceLimitId. Holds all resource-related fields —
 * benefits, roles, entity limits, rate limits, storage, credits, transfer
 * caps, operation caps, and frontend domains.
 */
export interface ResourceLimit {
  id: string;
  benefits?: string[];
  roleIds?: string[];
  entityLimits?: Record<string, number>;
  apiRateLimit?: number;
  storageLimitBytes?: number;
  fileCacheLimitBytes?: number;
  credits?: number;
  maxConcurrentDownloads?: number;
  maxConcurrentUploads?: number;
  maxDownloadBandwidthMB?: number;
  maxUploadBandwidthMB?: number;
  maxOperationCountByResourceKey?: Record<string, number>;
  creditLimitByResourceKey?: Record<string, number>;
  frontendDomains?: string[];
}
