import { getDb } from "../db/connection.ts";
import type {
  FileAccess,
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "file-access-cache.ts must not be imported in client-side code.",
  );
}

export interface CompiledFileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  compiledPattern: RegExp;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
}

export interface FileAccessCacheData {
  rules: CompiledFileAccess[];
}

const defaultSection: FileAccessSection = {
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  permissions: [],
};

const defaultUploadSection: FileAccessUploadSection = {
  ...defaultSection,
  maxFileSizeMB: undefined,
  allowedExtensions: [],
};

function normalizeSection(
  raw: Partial<FileAccessSection> | undefined,
): FileAccessSection {
  if (!raw) return { ...defaultSection };
  return {
    isolateSystem: !!raw.isolateSystem,
    isolateCompany: !!raw.isolateCompany,
    isolateUser: !!raw.isolateUser,
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
  };
}

function normalizeUploadSection(
  raw: Partial<FileAccessUploadSection> | undefined,
): FileAccessUploadSection {
  if (!raw) return { ...defaultUploadSection };
  return {
    ...normalizeSection(raw),
    maxFileSizeMB: raw.maxFileSizeMB !== undefined && raw.maxFileSizeMB !== null
      ? Number(raw.maxFileSizeMB)
      : undefined,
    allowedExtensions: Array.isArray(raw.allowedExtensions)
      ? raw.allowedExtensions.map(String)
      : [],
  };
}

export function compilePattern(pattern: string): RegExp {
  let normalized = pattern.trim();
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);

  const segments = normalized.split("/");
  const regexParts = segments.map((seg) => {
    const escaped = seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(/\*/g, "[^/]+");
  });

  return new RegExp("^" + regexParts.join("/") + "$");
}

export async function loadFileAccessData(): Promise<FileAccessCacheData> {
  const db = await getDb();
  const result = await db.query<[FileAccess[]]>(
    "SELECT * FROM file_access ORDER BY createdAt ASC",
  );

  const records = result[0] ?? [];
  const rules: CompiledFileAccess[] = records.map((r) => ({
    id: String(r.id),
    name: r.name,
    categoryPattern: r.categoryPattern,
    compiledPattern: compilePattern(r.categoryPattern),
    download: normalizeSection(
      r.download as Partial<FileAccessSection> | undefined,
    ),
    upload: normalizeUploadSection(
      r.upload as Partial<FileAccessUploadSection> | undefined,
    ),
  }));

  console.log(`[FileAccess] loaded ${rules.length} rules`);
  return { rules };
}
