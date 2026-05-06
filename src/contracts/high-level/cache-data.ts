import type { System } from "../system";
import type { Role } from "../role";
import type { Plan } from "../plan";
import type { Voucher } from "../voucher";
import type { MenuItem } from "../menu-item";
import type { FileAccessSection, FileAccessUploadSection } from "./file-access";
import type { FrontSetting } from "../front-setting";

// ============================================================================
// Setting scope
// ============================================================================

export interface SettingScope {
  systemId?: string;
  companyId?: string;
  actorId?: string;
}

// ============================================================================
// Core data types
// ============================================================================

export interface CoreData {
  systems: System[];
  roles: Role[];
  plans: Plan[];
  vouchers: Voucher[];
  menus: MenuItem[];
  systemsBySlug: Record<string, System>;
  systemsById: Record<string, System>;
  rolesBySystem: Record<string, Role[]>;
  plansBySystem: Record<string, Plan[]>;
  menusBySystem: Record<string, MenuItem[]>;
  plansById: Record<string, Plan>;
  vouchersById: Record<string, Voucher>;
}

export interface MissingSetting {
  key: string;
  firstRequestedAt: string;
}

export interface CompiledFileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  compiledPattern: string;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
}

export interface FileAccessCacheData {
  rules: CompiledFileAccess[];
}

// ============================================================================
// FrontCore data types
// ============================================================================

export interface FrontCoreData {
  settings: Record<string, FrontSetting>;
}

export interface MissingFrontSetting {
  key: string;
  firstRequestedAt: string;
}

/** Lazy cache loader signature. */
export type CacheLoader<T> = () => Promise<T>;

export interface PublicSystemData {
  name: string;
  slug: string;
  logoUri?: string;
  defaultLocale?: string;
  termsOfService?: string;
}
