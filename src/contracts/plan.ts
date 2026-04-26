export interface Plan {
  id: string;
  name: string;
  description: string;
  tenantId: string; // references system-only tenant row
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  roles: string[]; // role tokens granted by this plan
  entityLimits?: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes: number;
  planCredits: number;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  maxDownloadBandwidthMB: number;
  maxUploadBandwidthMB: number;
  maxOperationCount?: Record<string, number>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
