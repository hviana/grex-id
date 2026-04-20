import { getCache } from "./cache.ts";
import type { CompiledFileAccess, FileAccessCacheData } from "./file-access-cache.ts";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant.ts";
import type { FileAccessSection } from "@/src/contracts/file-access.ts";

if (typeof window !== "undefined") {
  throw new Error("file-access-guard.ts must not be imported in client-side code.");
}

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
}

function checkSection(
  section: FileAccessSection,
  params: FileAccessCheckParams,
): boolean {
  const { isolateSystem, isolateCompany, isolateUser, permissions } = section;

  const needsAuth = isolateSystem || isolateCompany || isolateUser;
  if (needsAuth && !params.claims) return false;

  if (isolateUser && params.claims!.actorId !== params.fileUserId) return false;
  if (isolateCompany && params.tenant.companyId !== params.fileCompanyId) return false;
  if (isolateSystem && params.tenant.systemSlug !== params.fileSystemSlug) return false;

  if (permissions.length > 0) {
    if (!params.claims) return false;
    if (params.tenant.roles.includes("superuser")) return true;
    if (params.tenant.permissions.includes("*")) return true;
    const hasPermission = permissions.some((p) =>
      params.tenant.permissions.includes(p)
    );
    if (!hasPermission) return false;
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

  for (const rule of rules) {
    if (!rule.compiledPattern.test(categoryStr)) continue;
    anyMatch = true;

    const section = params.operation === "download" ? rule.download : rule.upload;
    if (checkSection(section, params)) return { allowed: true };
  }

  return { allowed: !anyMatch };
}
