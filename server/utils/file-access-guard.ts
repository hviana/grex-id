import { getCache } from "./cache.ts";
import type {
  CompiledFileAccess,
  FileAccessCacheData,
} from "./file-access-cache.ts";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant.ts";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("file-access-guard.ts");

export interface FileAccessCheckParams {
  categoryPath: string[];
  fileCompanyId: string;
  fileSystemSlug: string;
  fileUserId: string;
  tenant: Tenant;
  claims?: TenantClaims;
  operation: "download" | "upload";
}

export interface FileAccessCheckResult {
  allowed: boolean;
  maxFileSizeBytes?: number;
  allowedExtensions?: string[];
}

function checkSection(
  section: FileAccessSection,
  params: FileAccessCheckParams,
): boolean {
  // Superuser role bypasses all checks (§6.4)
  if (params.tenant.roles.includes("superuser")) return true;

  const { isolateSystem, isolateCompany, isolateUser, roles } = section;

  const needsAuth = isolateSystem || isolateCompany || isolateUser;
  if (needsAuth && !params.claims) return false;

  if (isolateUser && params.claims!.actorId !== params.fileUserId) return false;
  if (isolateCompany && params.tenant.companyId !== params.fileCompanyId) {
    return false;
  }
  if (isolateSystem && params.tenant.systemSlug !== params.fileSystemSlug) {
    return false;
  }

  if (roles.length > 0) {
    if (!params.claims) return false;
    const hasRole = roles.some((r) => params.tenant.roles.includes(r));
    if (!hasRole) return false;
  }

  return true;
}

export async function checkFileAccess(
  params: FileAccessCheckParams,
): Promise<FileAccessCheckResult> {
  const cache = await getCache<FileAccessCacheData>("core", "file-access");
  const { rules } = cache;

  if (rules.length === 0) return { allowed: true };

  const categoryStr = params.categoryPath.join("/");
  let anyMatch = false;

  const matchingAllowed: CompiledFileAccess[] = [];

  for (const rule of rules) {
    if (!rule.compiledPattern.test(categoryStr)) continue;
    anyMatch = true;

    const section = params.operation === "download"
      ? rule.download
      : rule.upload;
    if (checkSection(section, params)) {
      matchingAllowed.push(rule);
    }
  }

  if (!anyMatch) return { allowed: true };
  if (matchingAllowed.length === 0) return { allowed: false };

  const result: FileAccessCheckResult = { allowed: true };

  if (params.operation === "upload") {
    const sizeLimits = matchingAllowed
      .map((r) => (r.upload as FileAccessUploadSection).maxFileSizeMB)
      .filter((v): v is number => v !== undefined && v > 0);
    if (sizeLimits.length > 0) {
      result.maxFileSizeBytes = Math.min(...sizeLimits) * 1048576;
    }

    const extLists = matchingAllowed
      .map((r) => (r.upload as FileAccessUploadSection).allowedExtensions)
      .filter((arr) => arr.length > 0);
    if (extLists.length > 0) {
      result.allowedExtensions = extLists.reduce((acc, list) =>
        acc.filter((ext) => list.includes(ext))
      );
    }
  }

  return result;
}
