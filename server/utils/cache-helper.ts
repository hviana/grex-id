import "server-only";

import type {
  LayerMerger,
  OwnLayer,
  RawLayer,
  ResolvedLayer,
  SettingValue,
} from "@/src/contracts/high-level/cache";
import type { ResourceLimit } from "@/src/contracts/resource-limit";
import type {
  CompiledFileAccess,
  CoreData,
} from "@/src/contracts/high-level/cache-data";
import type { MenuItemTree } from "@/src/contracts/high-level/menu-item";
import type { MenuItem } from "@/src/contracts/menu-item";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/high-level/file-access";
import type { Subscription } from "@/src/contracts/subscription";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { Voucher } from "@/src/contracts/voucher";
import type { TenantData } from "@/src/contracts/tenant-data";

import { genericList } from "../db/queries/generics.ts";
import {
  buildScopeKey as _buildScopeKey,
  fetchAllCoreData,
  resolveTenantForScope,
} from "../db/queries/core-settings.ts";
import {
  fetchActorResourceLimit,
  fetchSystemTenantRow,
  resolveRoleNames,
} from "../db/queries/tenants.ts";
import { getDb, normalizeRecordId } from "../db/connection.ts";
import { resolveLimits } from "./resolve-limits.ts";
import * as jose from "@panva/jose";

// ── Helpers ──────────────────────────────────────────────────────────────────

function setToArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map((x) => normalizeRecordId(x)).filter((x): x is string =>
      x !== null
    );
  }
  if (v instanceof Set) {
    return [...v].map((x) => normalizeRecordId(x)).filter((x): x is string =>
      x !== null
    );
  }
  return [];
}

function parseSettingKey(
  key: string,
): { table: "setting" | "front_setting"; stripped: string } | null {
  if (key.startsWith("setting.")) {
    return { table: "setting", stripped: key.slice(8) };
  }
  if (key.startsWith("front-setting.")) {
    return { table: "front_setting", stripped: key.slice(14) };
  }
  return null;
}

async function querySetting(
  table: "setting" | "front_setting",
  tenantId: string | null,
  settingKey: string,
): Promise<OwnLayer> {
  if (!tenantId) return { found: false, revision: "missing" };

  const { items } = await genericList<{ value: string; updatedAt: string }>({
    table,
    select: "id, value, updatedAt",
    tenant: { id: tenantId },
    extraConditions: ["key = $key"],
    extraBindings: { key: settingKey },
    extraAccessFields: ["key"],
    allowRawExtraConditions: true,
    limit: 1,
  });

  const row = items[0];
  if (!row) return { found: false, revision: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = row.value;
  }

  return {
    found: true,
    value: parsed as SettingValue,
    revision: row.updatedAt,
  };
}

async function tenantIdForLevel(
  level: "global" | "system" | "company" | "actor",
  ids: { systemId?: string; companyId?: string; actorId?: string },
): Promise<string | null> {
  switch (level) {
    case "global":
      return resolveTenantForScope("__core__");
    case "system":
      return resolveTenantForScope(ids.systemId!);
    case "company":
      return resolveTenantForScope(
        `${ids.systemId!}|${ids.companyId!}`,
      );
    case "actor":
      return resolveTenantForScope(
        `${ids.systemId!}|${ids.companyId!}|${ids.actorId!}`,
      );
  }
}

// ── Data Source Functions ────────────────────────────────────────────────────

export async function readGlobalFromSource(
  key: string,
): Promise<OwnLayer> {
  const parsed = parseSettingKey(key);
  if (parsed) {
    const tenantId = await tenantIdForLevel("global", {});
    return querySetting(parsed.table, tenantId, parsed.stripped);
  }

  switch (key) {
    case "core-data":
      return loadCoreDataBundle();
    case "file-access":
      return loadFileAccessRules();
    case "timezone":
      return loadTimezoneOffset();
    case "jwt-secret":
      return loadJwtSecretString();
    case "anonymous-jwt":
      return loadAnonymousJwtString();
    default:
      return { found: false, revision: "missing" };
  }
}

export async function readSystemFromSource(
  systemId: string,
  key: string,
): Promise<OwnLayer> {
  const parsed = parseSettingKey(key);
  if (parsed) {
    const tenantId = await tenantIdForLevel("system", { systemId });
    return querySetting(parsed.table, tenantId, parsed.stripped);
  }
  return { found: false, revision: "missing" };
}

export async function readCompanyFromSource(
  systemId: string,
  companyId: string,
  key: string,
): Promise<OwnLayer> {
  const parsed = parseSettingKey(key);
  if (parsed) {
    const tenantId = await tenantIdForLevel("company", { systemId, companyId });
    return querySetting(parsed.table, tenantId, parsed.stripped);
  }

  switch (key) {
    case "subscription":
      return loadSubscription(systemId, companyId);
    case "limits":
      return loadTenantLimits(systemId, companyId);
    case "tenant-data":
      return loadTenantData(systemId, companyId);
    default:
      return { found: false, revision: "missing" };
  }
}

export async function readActorFromSource(
  systemId: string,
  companyId: string,
  actorId: string,
  key: string,
): Promise<OwnLayer> {
  const parsed = parseSettingKey(key);
  if (parsed) {
    const tenantId = await tenantIdForLevel("actor", {
      systemId,
      companyId,
      actorId,
    });
    return querySetting(parsed.table, tenantId, parsed.stripped);
  }

  switch (key) {
    case "limits":
      return loadActorLimits(systemId, companyId, actorId);
    case "roles":
      return loadActorRoles(actorId);
    default:
      return { found: false, revision: "missing" };
  }
}

// ── Entity Loaders ───────────────────────────────────────────────────────────

async function loadCoreDataBundle(): Promise<OwnLayer> {
  const results = await fetchAllCoreData();

  const systems = results[0] ?? [];
  const roles = results[1] ?? [];
  const plans = results[2] ?? [];
  const menus = results[3] ?? [];
  const vouchers = results[4] ?? [];
  const sysTenants = results[5] ?? [];

  const systemsBySlug: Record<string, System> = {};
  const systemsById: Record<string, System> = {};
  for (const s of systems) {
    systemsBySlug[s.slug] = s;
    systemsById[s.id] = s;
  }

  // Build tenantId → systemId map from system-level tenants
  const tenantToSystem: Record<string, string> = {};
  for (const t of sysTenants) {
    const tId = String((t as unknown as Record<string, unknown>).id ?? "");
    const sId = String(
      (t as unknown as Record<string, unknown>).systemId ?? "",
    );
    if (tId && sId) tenantToSystem[tId] = sId;
  }

  function resolveSysKey(tenantIdsRaw: unknown): string {
    const arr = setToArray(tenantIdsRaw as Record<string, unknown> | undefined);
    const tenantId = String(arr[0] ?? "");
    return tenantToSystem[tenantId] ?? tenantId;
  }

  const rolesBySystem: Record<string, Role[]> = {};
  for (const r of roles) {
    const key = resolveSysKey(
      (r as unknown as Record<string, unknown>).tenantIds,
    );
    if (!rolesBySystem[key]) rolesBySystem[key] = [];
    rolesBySystem[key].push(r);
  }

  const plansBySystem: Record<string, Plan[]> = {};
  const plansById: Record<string, Plan> = {};
  for (const p of plans) {
    const key = resolveSysKey(
      (p as unknown as Record<string, unknown>).tenantIds,
    );
    if (!plansBySystem[key]) plansBySystem[key] = [];
    plansBySystem[key].push(p);
    plansById[String(p.id)] = p;
  }

  const menusBySystem: Record<string, MenuItem[]> = {};
  for (const m of menus) {
    const key = resolveSysKey(
      (m as unknown as Record<string, unknown>).tenantIds,
    );
    if (!menusBySystem[key]) menusBySystem[key] = [];
    menusBySystem[key].push(m);
  }

  const vouchersById: Record<string, Voucher> = {};
  for (const v of vouchers) {
    vouchersById[String(v.id)] = v;
  }

  const coreData: CoreData = {
    systems,
    roles,
    plans,
    vouchers,
    menus,
    systemsBySlug,
    systemsById,
    rolesBySystem,
    plansBySystem,
    menusBySystem,
    plansById,
    vouchersById,
  };

  return {
    found: true,
    value: coreData as unknown as SettingValue,
    revision: new Date().toISOString(),
  };
}

async function loadFileAccessRules(): Promise<OwnLayer> {
  const { items: records } = await genericList({
    table: "file_access",
    orderBy: "createdAt",
    limit: 1000,
  });

  const rules: CompiledFileAccess[] = records.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    categoryPattern: String(r.categoryPattern ?? ""),
    compiledPattern: String(r.categoryPattern ?? ""),
    download: normalizeSection(
      r.download as Partial<FileAccessSection> | undefined,
    ),
    upload: normalizeUploadSection(
      r.upload as Partial<FileAccessUploadSection> | undefined,
    ),
  }));

  return {
    found: true,
    value: rules as unknown as SettingValue,
    revision: new Date().toISOString(),
  };
}

async function loadTimezoneOffset(): Promise<OwnLayer> {
  const db = await getDb();
  const result = await db.query<[string]>("RETURN time::timezone()");
  const tz = result[0]?.[0] ?? "";

  const match = tz.match(/^([+-])(\d{2}):(\d{2})$/);
  let minutes = 0;
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    minutes = sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
  }

  return {
    found: true,
    value: minutes as unknown as SettingValue,
    revision: "constant",
  };
}

async function loadSubscription(
  systemId: string,
  companyId: string,
): Promise<OwnLayer> {
  const { items } = await genericList<Subscription>({
    table: "subscription",
    tenant: { companyId, systemId },
    select: [
      "id",
      "tenantIds",
      "planId",
      "paymentMethodId",
      "status",
      "currentPeriodStart",
      "currentPeriodEnd",
      "voucherId",
      "remainingPlanCredits",
      "remainingOperationCount",
      "creditAlertSent",
      "operationCountAlertSent",
      "autoRechargeEnabled",
      "autoRechargeAmount",
      "autoRechargeInProgress",
      "retryPaymentInProgress",
      "createdAt",
      "updatedAt",
    ],
    extraConditions: ["status = 'active'"],
    extraAccessFields: ["status"],
    allowRawExtraConditions: true,
    limit: 1,
  });

  const sub = items[0];
  if (!sub) return { found: false, revision: "missing" };

  return {
    found: true,
    value: sub as unknown as SettingValue,
    revision: sub.updatedAt,
  };
}

async function loadTenantData(
  systemId: string,
  companyId: string,
): Promise<OwnLayer> {
  const { items } = await genericList<TenantData>({
    table: "tenant_data",
    select: "id, data, updatedAt",
    tenant: { companyId, systemId },
    limit: 1,
  });

  const row = items[0];
  if (!row) return { found: false, revision: "missing" };

  return {
    found: true,
    value: row.data as unknown as SettingValue,
    revision: row.updatedAt,
  };
}

async function loadTenantLimits(
  systemId: string,
  companyId: string,
): Promise<OwnLayer> {
  const { get } = await import("./cache.ts");

  const subscription = await get({ systemId, companyId }, "subscription") as
    | Subscription
    | undefined;
  const coreData = await get(undefined, "core-data") as unknown as CoreData;

  let planRL: ResourceLimit | undefined;
  let voucherRL: ResourceLimit | undefined;

  if (subscription) {
    const plan = coreData.plansById[subscription.planId];
    if (plan) {
      const rawPlan = plan as unknown as Record<string, unknown>;
      planRL = rawPlan.resourceLimitId as ResourceLimit | undefined;
    }
    if (subscription.voucherId) {
      const voucher = coreData.vouchersById[subscription.voucherId];
      if (voucher) {
        const rawVoucher = voucher as unknown as Record<string, unknown>;
        voucherRL = rawVoucher.resourceLimitId as ResourceLimit | undefined;
      }
    }
  }

  return {
    found: true,
    value: { plan: planRL, voucher: voucherRL } as unknown as SettingValue,
    revision: subscription?.updatedAt ?? new Date().toISOString(),
  };
}

async function loadActorLimits(
  _systemId: string,
  _companyId: string,
  actorId: string,
): Promise<OwnLayer> {
  const rl = await fetchActorResourceLimit(actorId);

  return {
    found: true,
    value: { actor: rl ?? undefined } as unknown as SettingValue,
    revision: rl ? new Date().toISOString() : "missing",
  };
}

async function loadActorRoles(actorId: string): Promise<OwnLayer> {
  const rl = await fetchActorResourceLimit(actorId);
  if (!rl) return { found: false, revision: "missing" };

  const roleIds = setToArray(rl.roleIds);
  const names = await resolveRoleNames(roleIds);

  return {
    found: true,
    value: { names, ids: roleIds } as unknown as SettingValue,
    revision: new Date().toISOString(),
  };
}

async function loadJwtSecretString(): Promise<OwnLayer> {
  const tenantId = await tenantIdForLevel("global", {});
  const result = await querySetting("setting", tenantId, "auth.jwt.secret");
  return result;
}

async function loadAnonymousJwtString(): Promise<OwnLayer> {
  const { get } = await import("./cache.ts");

  const coreData = await get(undefined, "core-data") as unknown as CoreData;
  const coreSystem = coreData.systemsBySlug["core"];
  if (!coreSystem) {
    throw new Error("Core system not found");
  }

  const tenantRow = await fetchSystemTenantRow(coreSystem.id);
  if (!tenantRow) {
    throw new Error("Core tenant not found");
  }

  const secretString = await get(
    undefined,
    "setting.auth.jwt.secret",
  ) as string;
  if (!secretString) {
    throw new Error("Missing auth.jwt.secret");
  }
  const secret = new TextEncoder().encode(secretString);

  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const token = await new jose.SignJWT({
    tenantId: String(tenantRow.id),
    tenant: {
      id: String(tenantRow.id),
      systemId: String(tenantRow.systemId),
      companyId: String(tenantRow.companyId),
      actorId: "api_token:anonymous",
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("core")
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    found: true,
    value: token as unknown as SettingValue,
    revision: new Date().toISOString(),
  };
}

// ── Utility Exports ──────────────────────────────────────────────────────────

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

export function buildMenuTree(items: MenuItem[]): MenuItemTree[] {
  const map = new Map<string, MenuItemTree>();
  const roots: MenuItemTree[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId) {
      const parent = map.get(item.parentId);
      if (parent) {
        parent.children ??= [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function deriveActorType(
  actorId?: string,
): "user" | "api_token" | undefined {
  if (!actorId) return undefined;
  if (actorId.startsWith("api_token:")) return "api_token";
  if (actorId.startsWith("user:")) return "user";
  return undefined;
}

export { _buildScopeKey as buildScopeKey };

// ── File Access Helpers ──────────────────────────────────────────────────────

const defaultSection: FileAccessSection = {
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  roles: [],
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
    roles: setToArray(raw.roles),
  };
}

function normalizeUploadSection(
  raw: Partial<FileAccessUploadSection> | undefined,
): FileAccessUploadSection {
  if (!raw) return { ...defaultUploadSection };
  return {
    isolateSystem: !!raw.isolateSystem,
    isolateCompany: !!raw.isolateCompany,
    isolateUser: !!raw.isolateUser,
    roles: setToArray(raw.roles),
    maxFileSizeMB: raw.maxFileSizeMB,
    allowedExtensions: raw.allowedExtensions
      ? setToArray(raw.allowedExtensions as unknown)
      : [],
  };
}

// ── Limits Merger ────────────────────────────────────────────────────────────

function toResolved(raw: RawLayer): ResolvedLayer {
  if (raw.found) {
    return { found: true, value: raw.value, dependencyKey: raw.dependencyKey };
  }
  return { found: false, dependencyKey: raw.dependencyKey };
}

export const limitsMerger: LayerMerger = (
  parent: ResolvedLayer,
  child: RawLayer,
): ResolvedLayer => {
  if (!child.found) return parent;
  if (!parent.found) return toResolved(child);

  const combined = {
    ...(parent.value as Record<string, unknown>),
    ...(child.value as Record<string, unknown>),
  };

  return {
    found: true,
    value: resolveLimits({
      plan: combined.plan as ResourceLimit | undefined,
      voucher: combined.voucher as ResourceLimit | undefined,
      actor: combined.actor as ResourceLimit | undefined,
    }) as unknown as SettingValue,
    dependencyKey: child.dependencyKey,
  };
};
