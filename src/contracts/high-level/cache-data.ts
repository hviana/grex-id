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
  systemsBySlug: Map<string, System>;
  systemsById: Map<string, System>;
  rolesBySystem: Map<string, Role[]>;
  plansBySystem: Map<string, Plan[]>;
  menusBySystem: Map<string, MenuItem[]>;
  plansById: Map<string, Plan>;
  vouchersById: Map<string, Voucher>;
}

export interface MissingSetting {
  key: string;
  firstRequestedAt: string;
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

// ============================================================================
// FrontCore data types
// ============================================================================

export interface FrontCoreData {
  settings: Map<string, FrontSetting>;
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
