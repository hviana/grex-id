import Core from "./Core.ts";
import type { CompiledFileAccess } from "./Core.ts";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access.ts";
import type { Tenant } from "@/src/contracts/tenant";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("file-access-guard.ts");

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

async function resolveRoles(tenant: Tenant): Promise<string[]> {
  if (!tenant.actorId) return [];
  return Core.getInstance().getTenantRoles(tenant);
}

async function checkSection(
  section: FileAccessSection,
  params: FileAccessCheckParams,
): Promise<boolean> {
  const roles = await resolveRoles(params.tenant);
  if (roles.includes("superuser")) return true;

  const { isolateSystem, isolateCompany, isolateUser, roles: sectionRoles } =
    section;

  const needsAuth = isolateSystem || isolateCompany || isolateUser;
  if (needsAuth && !params.tenant.actorId) return false;

  if (isolateUser && params.tenant.actorId !== params.fileUserId) return false;
  if (isolateCompany && params.tenant.companyId !== params.fileCompanyId) {
    return false;
  }
  if (isolateSystem) {
    const core = Core.getInstance();
    const tenantSystemSlug = params.tenant.systemId
      ? await core.getSystemSlug(params.tenant.systemId)
      : undefined;
    if (tenantSystemSlug !== params.fileSystemSlug) return false;
  }

  if (sectionRoles.length > 0) {
    if (!params.tenant.actorId) return false;
    const hasRole = sectionRoles.some((r) => roles.includes(r));
    if (!hasRole) return false;
  }

  return true;
}

export async function checkFileAccess(
  params: FileAccessCheckParams,
): Promise<FileAccessCheckResult> {
  const rules = await Core.getInstance().getFileAccessRules();

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
    const allowed = await checkSection(section, params);
    if (allowed) {
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
