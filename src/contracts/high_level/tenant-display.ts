import type { TenantActorType } from "./tenant-context";
import type { BadgeValue } from "./components";

// ============================================================================
// Tenant display / form types — used by TenantView, TenantSubform, and
// tenant-scope editors across the admin panel.
// ============================================================================

/** Field names configurable in TenantSubform. */
export type TenantFieldName =
  | "systemId"
  | "companyId"
  | "actorId"
  | "systemSlug"
  | "roles"
  | "groupIds"
  | "actorType"
  | "exchangeable"
  | "frontendUse"
  | "frontendDomains"
  | "isolateSystem"
  | "isolateCompany"
  | "isolateUser";

/** Data shape produced by TenantSubform via getData(). */
export interface TenantFormData {
  systemId?: string;
  systemSlug?: string;
  companyId?: string;
  actorId?: string;
  actorType?: TenantActorType;
  roles?: string[];
  groupIds?: BadgeValue[];
  exchangeable?: boolean;
  frontendUse?: boolean;
  frontendDomains?: string[];
  isolateSystem?: boolean;
  isolateCompany?: boolean;
  isolateUser?: boolean;
}

/** Display data for TenantView — single tenant row rendered as a card. */
export interface TenantViewData {
  id: string;
  systemId?: string;
  systemName?: string;
  systemSlug?: string;
  companyId?: string;
  companyName?: string;
  actorId?: string;
  actorName?: string;
  actorType?: TenantActorType;
  roles?: string[];
  groupIds?: string[];
  exchangeable?: boolean;
  frontendUse?: boolean;
  frontendDomains?: string[];
  isolateSystem?: boolean;
  isolateCompany?: boolean;
  isolateUser?: boolean;
  isAnonymous?: boolean;
}
