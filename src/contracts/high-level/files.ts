import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "../file-access";
import type { Tenant } from "../tenant";

// ============================================================================
// File access guard types (from server/utils/file-access-guard.ts)
// ============================================================================

export interface FileAccessCheckParams {
  categoryPath: string[];
  fileCompanyId: string;
  fileSystemSlug: string;
  fileUserId: string;
  tenant: Tenant;
  operation: "download" | "upload";
}

export interface FileAccessCheckResult {
  allowed: boolean;
  maxFileSizeBytes?: number;
  allowedExtensions?: string[];
}

// ============================================================================
// File cache types (from server/utils/file-cache.ts)
// ============================================================================

export interface FileCacheResult {
  hit: boolean;
  noCache: boolean;
  data?: Uint8Array;
  mimeType?: string;
}

export interface FileCacheStats {
  usedBytes: number;
  maxBytes: number;
  fileCount: number;
}

/** File access rule list item used by the core admin file-access page. */
export interface FileAccessItem {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
  createdAt: string;
  [key: string]: unknown;
}
