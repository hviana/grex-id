export interface Voucher {
  id: string;
  code: string;
  applicableCompanyIds: string[]; // empty = universal
  applicablePlanIds: string[]; // empty = valid for every plan
  priceModifier: number;
  entityLimitModifiers?: Record<string, number>;
  apiRateLimitModifier: number;
  storageLimitModifier: number;
  fileCacheLimitModifier: number;
  maxConcurrentDownloadsModifier: number;
  maxConcurrentUploadsModifier: number;
  maxDownloadBandwidthModifier: number;
  maxUploadBandwidthModifier: number;
  maxOperationCountModifier?: Record<string, number>;
  creditModifier: number;
  expiresAt?: string;
  createdAt: string;
}
