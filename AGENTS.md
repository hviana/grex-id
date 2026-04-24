## 1. Overview

A serverless multi-tenant SaaS platform. **Users** authenticate once and belong
to one or more **companies**, each subscribed via a **plan** to one or more
**systems**. A **superuser** administers a Core layer (systems, roles, plans,
vouchers, menus, terms, settings, data deletion, file-access rules). Each system
ships its own UI, menus, and public homepage (`/?system=<slug>`), branded
through a `?system=` query parameter on every public page.

**Subframeworks** (`frameworks/<name>/`) are design-time code bundles that
extend Core at build time through a module registry. **Systems**
(`systems/<slug>/`) are runtime tenants registered through the same mechanism.
Both are namespace-isolated — no file ever mixes across Core, a system, or a
framework.

---

## 2. General Guidelines (cross-cutting invariants)

These hold everywhere in the codebase unless a layer explicitly scopes a
stricter rule. They are stated once.

### 2.1 Runtime & tooling

- **Serverless runtime.** Only standard Web APIs (`fetch`, `crypto`,
  `Request`/`Response`, `crypto.subtle`, Web Crypto). Never `node:*`, `Deno.*`,
  `Bun.*`.
- **TypeScript strict.** Isomorphic contracts under `src/contracts/`.
- **Allowed npm/jsr packages (exhaustive):** Next.js 16, SurrealDB 3.0,
  TailwindCSS 4.2, `@hviana/surreal-fs`, `@panva/jose`, `otplib`,
  `react-chartjs-2` (+ `chart.js` peer), `xlsx`. No others without explicit
  approval.
- **Server-only guard.** Every file under `server/` calls
  `assertServerOnly("<id>")` from `server/utils/server-only.ts` as the first
  statement after its import block. This is the **single** place `typeof window`
  is checked.

### 2.2 Visual & UX

- **Tailwind-only styling.** The sole custom CSS is a `:root` CSS-variables
  block (primary green `#02d07d`, hover green `#02b570`, light green `#00ff88`,
  secondary blue `#00ccff`, black, dark gray, light text).
- **Glassmorphism standard:** dark bg; cards
  `backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)]`;
  hover lift `-translate-y-1 + shadow glow`; gradients
  `from-primary-green to-secondary-blue`.
- **Emojis** for all icons — no icon libraries.
- **Mobile-first** always. Every component designs for small screens first.
- **Spinner on every async action**, at the origin of the action (button,
  content area, list, drag, etc.).
- **Debounced search** with a configurable delay — never un-debounced.
- **Placeholders** use `placeholder-white/30`; placeholder/label strings come
  from `t()`, never hardcoded.

### 2.3 Internationalization

- All UI text and all server-returned error messages are **i18n keys**, never
  human text. Backend error shape:
  `{ success:false, error:{ code:"VALIDATION", errors:string[] } }` or
  `{ code:"ERROR", message:"common.error.generic" }`.
- `t(key, locale, params?)` returns the key itself as fallback.
- **Locale resolution (frontend):** cookie `core_locale` → `navigator.languages`
  (exact then prefix match) → `System.defaultLocale` → `"en"`. `LocaleProvider`
  runs the chain once on mount. Changing locale persists to cookie and, if
  authenticated, to `profile.locale`.
- **Locale resolution (server):** `payload.locale` → `System.defaultLocale` →
  `"en"`.
- **Files:**
  `src/i18n/{locale}/{common,auth,core,billing,homepage,templates,validation}.json` +
  `systems/<slug>.json`; framework i18n under
  `frameworks/<name>/src/i18n/{locale}/<name>.json`.
- **DB-stored labels** (role display names, plan names, menu labels, file-access
  rule names, benefit strings) are **i18n keys**, not text. Machine-readable
  identifiers (slugs, permission tokens, category patterns) are not.

#### 2.3.1 Standard translation structure for identifier classes

Roles, permission tokens, entity names, and resource keys are machine-readable
but must be displayable. Resolution (first literal hit wins):

| Domain    | Key pattern                                                       |
| --------- | ----------------------------------------------------------------- |
| Core      | `<kind>s.<token>` (e.g. `roles.admin`, `resources.faceDetection`) |
| System    | `systems.<slug>.<kind>s.<token>`                                  |
| Framework | `frameworks.<name>.<kind>s.<token>`                               |

`kind ∈ {role,permission,entity,resource}`. A shared badge component builds the
key from `(kind, token, systemSlug?, frameworkName?)` — consumers never
hand-build keys. Operator-facing surfaces show both raw token and translation;
user-facing informational surfaces show translation only.

### 2.4 Data & safety

- **Compositional DB model.** Reusable structures (profile, address,
  entity_channel) are separate `SCHEMAFULL` tables linked via `record<>`.
  Composables carry **no back-pointer** to their parent — the parent holds the
  link (scalar for one-to-one, `array<record<>>` for collections). To create:
  create composable first, then parent referencing it. To delete: delete both in
  the same batched query.
- **Optimization.** Any field used in queries to select/filter data or used as a
  cursor should be indexed.
- **Single-batched-query rule.** Every query function batches all statements
  into one `db.query()` call. Never sequential `await db.query()`, never
  `Promise.all` of multiple `db.query()`. Pass values between statements with
  `LET`, use `UPSERT … WHERE` instead of read-then-write. The final
  `SELECT … FETCH` for record-link resolution is part of the same batch.
- **Queries live in `server/db/queries/`** (or the namespaced equivalent for
  systems/frameworks), never inlined in route handlers. **Generic queries
  first:** before writing a custom query, check whether
  `server/db/queries/generics.ts` (§2.4.1) already covers the operation. Only
  write a bespoke query when the generic helpers cannot express the required
  logic (multi-table compositional creates, complex subqueries, etc.).
- **Cursor-based pagination everywhere.** Never `SKIP`. Frontend supplies
  `limit`, capped server-side at 200.
- **Sensitive data never stored plainly at rest.** Three options in order of
  preference: (1) don't store (passwords → argon2 hash via
  `crypto::argon2::generate`/`compare` inside SurrealDB), (2) external
  tokenization (card data → gateway token), (3) AES-256-GCM encryption via the
  shared wrapper (§4.7). Forbidden: plaintext sensitive fields, plaintext in
  `verification_request.payload`, plaintext in `templateData`, plaintext in
  logs.
- **Mandatory query-layer pipeline** before every create/update:
  `standardizeField` → `validateField(s)` → `checkDuplicates` → entity-limit
  check → write. No ad-hoc `trim()` / regex / duplicate SELECTs in handlers.

#### 2.4.1 Generic queries (`server/db/queries/generics.ts`)

Entity-agnostic CRUD helpers that enforce every §2.4 rule automatically. Every
new query **must** check these first; bespoke queries are only for logic the
generics cannot express (compositional creates across multiple tables, complex
subqueries).

**API surface:**

| Function                           | Purpose                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `genericList<T>(opts, params)`     | Cursor-based paginated list with FULLTEXT search, tenant isolation, tag filtering, date range, FETCH |
| `genericGetById<T>(opts, id)`      | Single-record fetch with optional tenant guard                                                       |
| `genericCreate<T>(opts, data)`     | Standardize → validate → deduplicate → encrypt → CREATE                                              |
| `genericUpdate<T>(opts, id, data)` | Same pipeline on provided fields → UPDATE with `updatedAt`                                           |
| `genericDelete(opts, id)`          | DELETE with tenant guard; returns `{ deleted }`                                                      |
| `genericCount(opts)`               | `SELECT count()` with tenant isolation, date range                                                   |

**Key interfaces:**

- `FieldSpec { field, entity?, unique?, encryption? }` — per-field processing.
  `encryption` accepts `"aes-256-gcm"` (calls `encryptField` before write) or
  `"argon2-hash"` (defers to `crypto::argon2::generate` inside SurrealQL —
  plaintext never leaves the query layer).
- `TenantIsolation { companyId?, systemId?, userId? }` — optional ID-based
  scoping. When `userId` is provided, its value is the **column name** in the
  table (e.g. `"ownerId"`). Any omitted ID is silently skipped.
- `GenericListOptions` — table, select, fetch, cursorField, orderBy,
  searchFields, dateRangeField, extraConditions, extraBindings.
- `GenericCrudOptions` — table, ensureTenant, fields (FieldSpec[]), fetch.
- `TagFilter { tagsColumn?, tagNames: string[] }` — optional tag-name filtering
  on `genericList`. Produces one AND-combined `CONTAINS` subquery per tag name
  (all must match). `tagsColumn` defaults to `"tags"`.
- `DateRangeFilter { start?, end? }` — optional inclusive date-range filtering
  on `genericList` and `genericCount`. Applied against the column named in
  `GenericListOptions.dateRangeField` (e.g. `"createdAt"`). Each bound is an
  ISO-8601 datetime; either or both may be omitted.

**Processing pipeline (create / update):**

1. For each `FieldSpec` present in `data`:
   `standardizeField(field, value, entity?, encryption?)`. Standardization runs
   first (trim, format, entity-specific overrides); then, if `encryption` is
   set, the value is transformed in-place: `"aes-256-gcm"` calls `encryptField`
   and returns the ciphertext envelope; `"argon2-hash"` calls
   `crypto::argon2::generate` via SurrealDB and returns the hash. The query
   builder writes every value as a plain `$binding` — it has zero encryption
   logic.
2. `validateFields([...])` — returns i18n error keys; aborts on failure.
3. `checkDuplicates(table, uniqueFields)` — aborts on conflict.
4. Single batched `db.query()` with all values parameterized.

### 2.5 Tenant & authorization

- **Every request, job, and handler operates against a `Tenant` object.**
  Unauthenticated requests receive a synthesized anonymous tenant — never
  `null`.
- Backend code **never** reads `companyId`/`systemId`/`roles`/`permissions` from
  query strings, cookies, or bodies. They come from the tenant/claims only.
- **Token exchange is the sole mechanism to change tenant.** API tokens and
  connected-app tokens carry `exchangeable: false` and are bound for life to
  their issue-time tenant.
- All queries, utilities, event handlers, and jobs accept `tenant: Tenant` — not
  loose IDs. PR review rejects helpers that reintroduce scattered context.

### 2.6 Generic-first UI

Every piece of UI reuses an existing shared primitive before writing ad-hoc
markup. Classes of reusable primitives (§10.3) each have one authoritative
implementation; new needs extend it with a `variant`/prop or extract a new
primitive under the appropriate shared folder. Forbidden: bespoke lists with
their own pagination, hand-rolled email/phone inputs, plain comma-separated
`<input>` for structured data.

### 2.7 Namespace isolation (Core / systems / frameworks)

- A file belongs to exactly one of: Core, one system, one framework.
- **System** code lives under `systems/<slug>/`,
  `server/db/{migrations,queries,frontend-queries,seeds}/systems/<slug>/`,
  `server/event-queue/handlers/systems/<slug>/`,
  `src/components/systems/<slug>/`, `app/api/systems/<slug>/`,
  `public/systems/<slug>/`, `src/i18n/<locale>/systems/<slug>.json`.
- **Framework** code lives entirely under `frameworks/<name>/` with the same
  internal layer shape (`app/api/<name>/`, `src/components/<name>/`,
  `server/db/migrations/`, `server/db/queries/`, `server/utils/`,
  `src/i18n/<locale>/<name>.json`).
- API routes are namespaced: framework → `/api/<name>/…`; system →
  `/api/systems/<slug>/…`.
- **Migrations are globally numbered** but physically isolated. The runner scans
  root + every `systems/<slug>/` + every
  `frameworks/<name>/server/db/migrations/`, merges, sorts by numeric prefix
  globally, and records the relative path in `_migrations`. Same pattern for
  seeds.
- The Core never imports system or framework code directly — all wiring goes
  through the module registry (§4.6).
- Each system/framework **may** ship its own `AGENTS.md` that inherits Core by
  reference and documents only what is namespace-specific. Never overrides a
  Core rule.
- Every empty structural folder contains `.gitkeep`.

### 2.8 Reload-on-write

Any mutation of a cached datum (core settings, front settings, subscription,
plan, voucher, role, menu, system, file-access rule) is followed in the same
request by a cache refresh call (`updateCache` or a reload method that delegates
to it). Derived caches (e.g. JWT secret, derived from core settings) are cleared
when their source changes.

### 2.9 Fail-fast middleware ordering

Compose middleware cheapest-first: in-memory checks before Core-cache lookups
before DB counts. A rejected request never pays the cost of later middleware. A
middleware that queries the DB without a cache comes last.

---

## 3. Data Layer

### 3.1 Conventions

- All tables `SCHEMAFULL`.
- **FULLTEXT analyzer** `general_analyzer_fts` (BM25) indexes searchable
  name/label columns.
- **`_migrations`** tracks applied migrations by relative path (UNIQUE `name`).
- **Passwords**: `crypto::argon2::generate` / `crypto::argon2::compare` — inside
  SurrealDB, never in app code.
- **Live Query permissions.** Every table readable from the frontend declares
  `PERMISSIONS FOR select WHERE <ownership>` (e.g. `userId = $auth.id`). Only
  `LIVE SELECT` is allowed from the frontend. The frontend WebSocket
  authenticates via SurrealDB user/password from `setting` (not the app token).

### 3.2 Connections

| Side     | Transport        | Purpose                           | Credentials source                                                                                        |
| -------- | ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend  | HTTP (singleton) | All reads/writes from server code | `database.json` (root, git-ignored) via `Core.DB_*` statics                                               |
| Frontend | WebSocket        | `LIVE SELECT` only                | `setting` rows `db.frontend.{url,namespace,database,user,pass}` (served via `GET /api/public/front-core`) |

### 3.3 Compositional entities

Three reusable composables, each `SCHEMAFULL` and unaware of its parents:

| Table            | Fields (rule-bearing)                                                                       | Referenced by                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `profile`        | name (FULLTEXT), avatarUri, age, locale, `recovery_channels: array<record<entity_channel>>` | `user.profile`, `lead.profile`                                                            |
| `address`        | street, number, …, postalCode                                                               | `company.billingAddress` (option), `payment_method.billingAddress`, `location` (embedded) |
| `entity_channel` | type (open string; seeded `"email"`,`"phone"`), value, verified (bool, default false)       | `user.channels[]`, `lead.channels[]`, `profile.recovery_channels[]`                       |

**`profile.recovery_channels`** is reserved **exclusively** for account-recovery
paths — never read by login, communication dispatch, or the approval invariant.
It is independent of `user.channels`.

### 3.4 Core tables (rule-bearing fields only)

| Table                  | Key rules                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                 | `profile: record<profile>`; `channels: array<record<entity_channel>>`; `passwordHash`; `twoFactorEnabled`; `twoFactorSecret`, `pendingTwoFactorSecret` (AES-GCM envelopes); `stayLoggedIn`. No identity fields (email/phone) on the row itself. |
| `oauth_identity`       | One row per `(provider, providerUserId)` linked to `userId`. Unique composite index on that pair; secondary index on `userId`. Multiple providers per user allowed.                                                                             |
| `company`              | Unique `document`; `billingAddress: option<record<address>>`; `ownerId`                                                                                                                                                                         |
| `company_user`         | Unique `(companyId, userId)`                                                                                                                                                                                                                    |
| `system`               | Unique `slug`; `logoUri`, `defaultLocale`, `termsOfService`                                                                                                                                                                                     |
| `company_system`       | Unique `(companyId, systemId)`. Idempotent creation (existence-check, never raw CREATE).                                                                                                                                                        |
| `user_company_system`  | Unique `(userId, companyId, systemId)`. Holds per-tenant `roles`. Admin invariant: every tenant has ≥1 user with role `"admin"`.                                                                                                                |
| `role`                 | Unique `(name, systemId)`; `isBuiltIn`                                                                                                                                                                                                          |
| `plan`                 | See §7.1 for rule-bearing fields (entity limits, credits, transfer limits, per-resource op caps)                                                                                                                                                |
| `voucher`              | Unique `code`; `applicableCompanyIds`, `applicablePlanIds` (empty = universal); per-limit modifiers (§7.7)                                                                                                                                      |
| `menu_item`            | `parentId` optional, unlimited depth; index `(systemId, parentId, sortOrder)`                                                                                                                                                                   |
| `subscription`         | See §7.2                                                                                                                                                                                                                                        |
| `payment_method`       | `billingAddress: record<address>`; `isDefault`                                                                                                                                                                                                  |
| `credit_purchase`      | Status `pending                                                                                                                                                                                                                                 |
| `payment`              | Unified payment ledger (§7.5)                                                                                                                                                                                                                   |
| `connected_app`        | Scoped per (company, system); `apiTokenId` link for revocation cascade; per-resource `maxOperationCount`                                                                                                                                        |
| `connected_service`    | Scoped per (company, system, user). Admin sees all users' services; regular users see only their own. FULLTEXT on `name` for search. `data` is FLEXIBLE for per-service config.                                                                 |
| `api_token`            | Row id = universal actor id. Bearer is a JWT carrying that id. Fields: tenant (flexible), `neverExpires` XOR `expiresAt`, `frontendUse`, `frontendDomains`, `revokedAt`, per-resource `maxOperationCount`, `monthlySpendLimit`                  |
| `usage_record`         | `actorType ∈ user                                                                                                                                                                                                                               |
| `credit_expense`       | Daily container; unique `(companyId, systemId, resourceKey, day)`; fields `amount` (cents total), `count` (ops), `actorId` optional — both increment via UPSERT                                                                                 |
| `queue_event`          | `payload: object FLEXIBLE`                                                                                                                                                                                                                      |
| `delivery`             | One row per handler per event; status `pending                                                                                                                                                                                                  |
| `verification_request` | `actionKey` (i18n), `ownerId: record<user                                                                                                                                                                                                       |
| `setting`              | Unique `(key, systemSlug)`. `systemSlug="core"` = core-level default; any other non-empty = per-system override. ASSERT not empty. Server-only consumption.                                                                                     |
| `front_setting`        | Same shape as `setting`. Physically separate table so the frontend bundle cannot leak server secrets.                                                                                                                                           |
| `lead`                 | `profile: record<profile>`; `channels: array<record<entity_channel>>`; `companyIds`                                                                                                                                                             |
| `lead_company_system`  | Unique `(leadId, companyId, systemId)`                                                                                                                                                                                                          |
| `location`             | Scoped per (company, system); address embedded inline                                                                                                                                                                                           |
| `tag`                  | Scoped per (company, system); unique `(name, companyId, systemId)`                                                                                                                                                                              |
| `file_access`          | Unique `name` (FULLTEXT); `categoryPattern`, `download` + `upload` sections (see §6)                                                                                                                                                            |

**File storage.** `@hviana/surreal-fs` manages its own `surreal_fs_files` /
`surreal_fs_chunks` via `fs.init()`. There is no separate `file_metadata` table.

### 3.5 Migration & seed runners

- **Migrations runner** (`server/db/migrations/runner.ts`): scans the three
  trees (root, systems, frameworks), sorts by numeric prefix globally, executes
  pending in a transaction, records the relative path.
- **Seeds runner** (`server/db/seeds/runner.ts`): same scan pattern. Each
  `NNN_*.ts` exports `async function seed(db: Surreal): Promise<void>` and is
  idempotent (existence-check before insert).
- **Required seeds:** superuser (creates a `profile`, a verified `email`
  `entity_channel`, and a `user` linking them — satisfies the approval invariant
  from first boot); default core settings; default front-core settings; default
  file-access rules.

---

## 4. Cross-cutting Backend Utilities (structural singletons)

### 4.1 Tenant contract

```ts
interface Tenant {
  systemId: string; // "0" for unauthenticated / non-tenant
  companyId: string; // "0" for unauthenticated / non-tenant
  systemSlug: string; // "core" for core-scoped; else system slug
  roles: string[];
  permissions: string[]; // "*" wildcard allowed
}
type TenantActorType = "user" | "api_token" | "connected_app" | "anonymous";
interface TenantClaims extends Tenant {
  actorType: TenantActorType;
  actorId: string; // "0" for anonymous
  exchangeable: boolean; // true only for actorType="user"
}
```

**Helpers (`server/utils/tenant.ts`):** `getSystemTenant()` (for workers:
`{systemSlug:"core", roles:["superuser"], permissions:["*"]}`),
`getAnonymousTenant(systemSlug)`, `assertScope(tenant,{companyId?,systemId?})`.
These are the only places such tenants are constructed.

### 4.2 JWT & actor-validity model

Every bearer (user session, API token, connected-app token) is a JWT produced
via `@panva/jose` with claims
`{ tenant, actorType, actorId, exchangeable, exp, iat }`. There is no
opaque-token path, no token hash, no `jti`.

**Actor-validity cache (`server/utils/actor-validity.ts`)** — the sole authority
consulted by `withAuth`. Sharded per tenant:
`"<companyId>:<systemId>" → Set<string>` of actor ids. Absence = revocation.
Membership is a synchronous in-memory call; no DB probe on the authenticated
request path.

Public API:

```ts
isActorValid(tenant, actorId): boolean
ensureActorValidityLoaded(tenant): Promise<void>   // lazy per tenant
rememberActor(tenant, actorId): Promise<void>
forgetActor(tenant, actorId): Promise<void>
reloadTenant(tenant): Promise<void>
```

**Mutation points (same request as the durable DB write):**

| Event                                              | Action                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Login                                              | `rememberActor(tenant, user.id)`                                        |
| Logout                                             | `forgetActor(tenant, claims.actorId)`                                   |
| Token exchange                                     | `forgetActor(oldTenant, user.id)` + `rememberActor(newTenant, user.id)` |
| Refresh                                            | No mutation (extension only — fails if id absent)                       |
| API token / connected-app create / OAuth authorize | `rememberActor(tenant, token.id)`                                       |
| API token / connected-app revoke                   | Set `revokedAt` in batched query + `forgetActor`                        |
| Role/membership change in `user_company_system`    | `forgetActor(tenant, userId)`                                           |
| Data-deletion scoped to a tenant                   | `reloadTenant(tenant)`                                                  |

**Boot-time filter:** lazy tenant load =
`SELECT id FROM api_token WHERE companyId=$ AND systemId=$ AND revokedAt IS NONE`.
User sessions start absent; cold start forces re-login (by design — logout and
role-change eviction would otherwise be indistinguishable from empty).

Multi-instance deployments drive a broadcast channel (pub/sub or live query on a
signal row) that calls `reloadTenant` on receipt; API shape is unchanged.

### 4.3 Middleware pipeline (`server/middleware/compose.ts`)

```ts
type Middleware = (req, ctx, next) => Promise<Response>;
interface RequestContext {
  tenant: Tenant;
  claims?: TenantClaims;
}
```

Standard ordering (cheapest → costliest):

| # | Middleware                                              | Cost                                                                            | Notes                                                                                                                                                  |
| - | ------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | `withRateLimit(config)`                                 | In-memory sliding window                                                        | Key `{companyId}:{systemId}` or `{ip}` for auth routes. Global plan limit distributed across active actors: `floor(limit/actorCount)` min 1.           |
| 2 | `withAuth({roles?,permissions?,requireAuthenticated?})` | JWT verify + CORS (for `frontendUse` tokens) + `isActorValid` — **no DB query** | Populates `ctx.tenant`/`ctx.claims` or synthesized anonymous. Superusers bypass role/permission checks. Routes never parse `Authorization` themselves. |
| 3 | `withPlanAccess(featureNames[])`                        | Core cache read                                                                 | Verifies subscription active + within `currentPeriodEnd` + plan grants ≥1 listed permission                                                            |
| 4 | `withEntityLimit(entityName)`                           | DB count                                                                        | Plan + voucher modifier from cache; count is the only DB call                                                                                          |

Auth routes (`/api/auth/*`) use only `withRateLimit`, but still receive the
synthesized anonymous tenant.

### 4.4 Cache registry (`server/utils/cache.ts`)

Every server-side cache — Core data, FrontCore data, subscriptions, JWT secret,
actor-validity partitions, file-access rules, system/framework caches — goes
through this module. No ad-hoc `Map + loaded + loadPromise` anywhere.

```ts
registerCache<T>(slug, name, loader): void
getCache<T>(slug, name): Promise<T>          // single-flight
updateCache<T>(slug, name): Promise<T>       // re-executes loader, replaces value
getCacheIfLoaded<T>(slug, name): T | undefined
clearCache(slug, name): void
clearAllCacheForSlug(slug): void
```

**Rules.** Loaders are pure data fetchers (no mutation, no request dependency)
and may compose from other caches. Invalidation is always explicit (no TTL
expiry). Derived caches (e.g. JWT secret from core settings) are cleared when
their source changes. Dynamic per-tenant caches are registered on first access
and tracked in a `Set` so bulk eviction can iterate.

Core-owned caches:

| Slug             | Name                         | Loader                     | Invalidated by                                      |
| ---------------- | ---------------------------- | -------------------------- | --------------------------------------------------- |
| `core`           | `data`                       | `loadCoreData`             | `Core.reload()` after any core-entity mutation      |
| `core`           | `front-data`                 | `loadFrontCoreData`        | `FrontCore.reload()`                                |
| `core`           | `jwt-secret`                 | from core settings         | `Core.reload()` (derived)                           |
| `core`           | `file-access`                | load rules + compile regex | rule mutations                                      |
| `core`           | `sub:<companyId>:<systemId>` | load subscription          | `Core.reloadSubscription()` after billing mutations |
| `actor-validity` | `<companyId>:<systemId>`     | `loadActorValidityTenant`  | login/logout/exchange/token CRUD/role change        |

**Core data** is stored as pre-built `Map` indexes (`systemsBySlug`,
`rolesBySystem`, `plansBySystem`, `menusBySystem`, `plansById`, `vouchersById`,
`settings`) for O(1) lookups. This principle — design for O(1) — holds for all
caches.

### 4.5 Core & FrontCore singletons

Both use the cache registry. Both are server-only.

- **`Core`**: settings (getSetting with `(key, systemSlug?)` → per-system
  override → core-level → undefined + missing-key log), cached
  system/role/plan/menu/voucher accessors, subscription helpers
  (`getActiveSubscriptionCached`, `ensureSubscription`, `reloadSubscription`,
  `evictAllSubscriptions`), `reload()`. DB credentials from `database.json`.
- **`FrontCore`**: same shape, reads exclusively from `front_setting`. Frontend
  consumes via `useFrontCore` hook calling `GET /api/public/front-core` (never
  imports the class).

**Settings rule.** `systemSlug="core"` is the core-level default; any other
non-empty value is a per-system override. The admin panel has two separate pages
(server settings / front settings), each with a system-scope dropdown and a
"missing keys" banner with "Add all missing". Physical separation of `setting`
vs `front_setting` is a load-bearing security invariant.

**Seeded core settings** (non-exhaustive — the full list is in
`002_default_settings.ts`; rules-bearing categories):

| Category          | Keys                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App               | `app.name`, `app.baseUrl`, `app.defaultSystem`                                                                                                                                                                                          |
| Auth tokens       | `auth.token.expiry.minutes` (15), `auth.token.expiry.stayLoggedIn.hours` (168), `auth.rateLimit.perMinute` (5)                                                                                                                          |
| Auth comms        | `auth.communication.expiry.minutes` (15), `auth.communication.maxCount` (5), `auth.communication.windowHours` (1), `auth.communication.defaultChannels` (`["email","sms"]`)                                                             |
| Auth extra        | `auth.oauth.providers` (`"[]"` = disabled), `auth.encryption.key` (32-byte base64 AES-256-GCM key; dev-only seed, deploy must override), `auth.entityChannel.maxPerOwner` (10), `auth.entityChannel.defaultTypes` (`["email","phone"]`) |
| Billing           | `billing.autoRecharge.minAmount` (500), `billing.autoRecharge.maxAmount` (50000)                                                                                                                                                        |
| Caching           | `cache.core.size` (20 MB), `cache.file.hitWindowHours` (1)                                                                                                                                                                              |
| Transfer defaults | `transfer.default.{maxConcurrentDownloads,maxConcurrentUploads,maxDownloadBandwidthMB,maxUploadBandwidthMB}` (0 = unlimited)                                                                                                            |
| DB frontend       | `db.frontend.{url,namespace,database,user,pass}`                                                                                                                                                                                        |
| Terms             | `terms.generic`                                                                                                                                                                                                                         |

**Seeded front-core settings:** `front.app.name`, `front.app.brandPrimaryColor`,
`front.support.{email,helpUrl}`, `front.botProtection.siteKey`,
`front.payment.publicKey`, `front.dataTracking.trackedCharacteristics` (`"[]"`).

### 4.6 Module registry (`server/module-registry.ts`)

Central registration API called at boot by `registerCore()`, each system's
`register()`, and each framework's `register()`. The Core **never** imports
system or framework code.

```ts
// Event handlers (one name = event + function key)
registerHandler(name, fn);
getHandler(name);
getAllHandlers();
// Jobs
registerJob(name, startFn);
getAllJobs();
// i18n
registerSystemI18n(slug, locale, data);
// Communication
registerTemplate(channel, path, fn); // static per-channel
registerTemplateBuilder(name, fn); // dynamic (called per channel iteration)
registerChannel(name); // enables send_<channel> dispatch
// Cache forwarders: registerCache/getCache/updateCache/clearCache/clearAllCacheForSlug
// Lifecycle hooks
registerLifecycleHook(event, hook);
runLifecycleHooks(event, payload);
// Events: "lead:delete", "lead:verify"
// Components
registerComponent, registerHomePage;
```

**Boot sequence** (`server/jobs/index.ts`):

1. `registerCore()` — core caches, core event handlers (`send_communication`,
   `send_email`, `send_sms`, `process_payment`, `auto_recharge`,
   `resolve_async_payment`, `payment_async_completed`), core template builders
   (`human-confirmation`, `notification`), core jobs.
2. `registerAllSystems()` — iterate `systems/<slug>/register.ts`.
3. `registerAllFrameworks()` — iterate `frameworks/<name>/register.ts`.
4. `startEventQueue()` — worker per registered handler name, using its
   `WorkerConfig`.
5. Iterate `getAllJobs()` — start recurring jobs.

Exactly one `register()` function per system/framework, imported only by the
corresponding index file.

### 4.7 Field encryption wrapper (`server/utils/crypto.ts`)

Single AES-256-GCM helper used by every "encryption at rest" path.

- Web Crypto (`crypto.subtle`); 12-byte random IV per call; 16-byte auth tag
  appended by GCM; 32-byte key from `auth.encryption.key` (decoded once at boot
  into a `CryptoKey`; rotation requires deploy + re-encryption migration).
- **Wire format:** base64 `<iv>:<ciphertext+tag>`. DB columns stay
  `TYPE option<string>`.
- **API:** `encryptField(pt)`, `decryptField(env)` (throws on tamper — caller
  treats as cryptographic failure), `decryptFieldOptional(env|null|undefined)`.
- Every encrypted-field read/write boundary goes through these helpers.
  Plaintext never leaves request scope (no logging, no copy to another column,
  no `verification_request.payload`).
- Only this file calls `crypto.subtle.encrypt/decrypt` for at-rest data.

### 4.8 Field standardization & validation

- **`standardizeField(field, value, entity?)`** — resolution: entity+field →
  generic → default (`trim` + strip `<>`). Built-ins cover `email`
  (trim/lowercase), `phone` (digits only), `name` (trim+collapse), `slug`,
  `document`.
- **`validateField(field, value, entity?)` / `validateFields([])`** — returns
  array of i18n keys (empty = valid). Built-ins: `email`, `phone`
  (optional-unless-provided), `password`, `name`, `slug`, `url`, `currencyCode`,
  `cnpj`. Validation i18n keys live in `src/i18n/{locale}/validation.json`.
- **`checkDuplicates(entity, [{field,value}])`** — called before every `CREATE`
  on entities with UNIQUE indices (entity channels, company document, system
  slug, voucher code, tag per scope, etc.). Independent per-field check so
  conflicts map to i18n keys.

Both systems support `registerStandardizer`/`registerValidator` for framework
extension.

### 4.9 Guards & limit resolution (`server/utils/guards.ts`)

Internal functions callable from middleware, queries, handlers, and jobs. Read
plan + voucher + subscription from Core cache only (no DB for static config).
All return `{ <value>, planLimit, voucherModifier }`. Effective =
`max(0, planLimit + voucherModifier)`, where **0 means unlimited** for
transfer/operation limits.

| Function                                    | Returns                                                  |
| ------------------------------------------- | -------------------------------------------------------- |
| `resolveEntityLimit({entityName,…})`        | `{ limit, planLimit, voucherModifier }`                  |
| `checkPlanAccess(tenant, featureNames)`     | `{ granted, denyCode? }` (`NO_SUBSCRIPTION               |
| `resolveRateLimitConfig`                    | `{ globalLimit, planRateLimit, voucherModifier }`        |
| `resolveFileCacheLimit`                     | `{ maxBytes, planLimit, voucherModifier }`               |
| `resolveMaxConcurrentDownloads`/`Uploads`   | `{ max, planLimit, voucherModifier }`                    |
| `resolveMaxDownloadBandwidth`/`Upload`      | `{ maxMB, planLimit, voucherModifier }`                  |
| `resolveMaxOperationCount({resourceKey,…})` | per-resourceKey `{ max, planLimit, voucherModifier }`    |
| `resolveAllOperationCounts`                 | merged `Record<resourceKey, number>` for subscribe/renew |

### 4.10 Rate limiter, usage tracker, credit tracker

- **Rate limiter** — sliding window, in-memory, per `{companyId}:{systemId}` (or
  `{ip}` for auth). See §4.3.
- **Usage tracker** —
  `trackUsage({actorType, actorId, companyId, systemId, resource, value})`
  upserts `usage_record` for `YYYY-MM`.
- **Credit tracker** —
  `trackCreditExpense({resourceKey, amount, companyId, systemId})` UPSERTs the
  daily `credit_expense` incrementing both `amount` and `count`.
  `consumeCredits({resourceKey, amount, companyId, systemId})` deducts
  atomically (plan credits first, then purchased) and enforces the
  per-resourceKey operation cap, all in one batched query (algorithm in §7.3).

### 4.11 File-cache manager (`server/utils/file-cache.ts`)

Per-tenant in-memory file cache (binary content — separate from the config cache
registry). **Sliding-Window Size-Aware LFU**: priority = `hitsInWindow / size`
(old timestamps pruned each access; cache forgets old popularity without an
explicit aging step).

- Keyed by `"<companyId>:<systemSlug>"` (tenants) or `"core"` (anonymous /
  unmatched system).
- Parameters: `maxSize` (from `resolveFileCacheLimit` or `cache.core.size`),
  `hitWindowMs` (from `cache.file.hitWindowHours`).
- `access(tenantKey, fileId, fileSize, maxSize, data?, hitWindowMs?, mimeType?) → { hit, noCache, data?, mimeType? }`.
  On cache miss, evicts lowest-scoring entries until `fileSize` fits. Files
  larger than `maxSize` are never cached (`noCache:true`).
- `evict(fileId)`, `clearTenant(tenantKey)`,
  `getStats(tenantKey, maxSize) → { usedBytes, maxBytes, fileCount }`.

### 4.12 Communication guard (`server/utils/verification-guard.ts`)

`communicationGuard({ownerId, actionKey, payload?, tenant?})` is the **single**
helper for every verification/communication send. One batched query enforces:

1. **Previous-not-expired** — unused non-expired `verification_request` for same
   `(ownerId, actionKey)` → blocked (`reason: "previousNotExpired"`).
2. **Rate limit** — ≥ `auth.communication.maxCount` requests for that
   `(ownerId, actionKey)` in `auth.communication.windowHours` → blocked
   (`reason: "rateLimited"`).
3. Otherwise creates the `verification_request` row atomically with all tenant
   context.

Returns `{ allowed, reason?, token?, expiresAt? }`. Anti-enumeration routes
(forgot-password, account-recovery) return generic success on block;
authenticated and public-lead routes return 429 with the matching i18n key.

### 4.13 CORS

`server/utils/cors.ts` enforces `api_token.frontendDomains` for
`frontendUse=true` tokens. Missing/mismatched `Origin` → 403. Non-frontend
tokens presenting a browser `Origin` → rejected. Preflight bypasses `withAuth`
but runs CORS.

---

## 5. Event Queue & Communication

### 5.1 Queue architecture

Two tables: `queue_event` (published fact), `delivery` (one per handler per
event).

- **Publisher** `publish(name, payload, availableAt?)`: inserts `queue_event`,
  then a `delivery` per registered handler for that name.
- **Registry** (§4.6): `Set<string>`; one event = one handler, same name.
- **Worker loop** (per handler, with
  `WorkerConfig { handler, maxConcurrency, batchSize, leaseDurationMs, idleDelayMs, retryBackoffBaseMs, maxAttempts }`):
  claim batch atomically by setting
  `status=processing`/`leaseUntil`/`workerId`/`attempts++`; execute; on success
  mark `done`; on failure either dead (attempts ≥ maxAttempts) or re-queue with
  `backoff = retryBackoffBaseMs * 2^(attempts-1)`. Expired leases are naturally
  re-claimable (`OR leaseUntil <= now()`).
- **Idempotency**: every handler is idempotent. Use `delivery.id` / `event.id`
  as idempotency key against external services.

### 5.2 Communication model — one contract, two template families

All communication flows through a single entry point. Callers publish:

```ts
publish("send_communication", {
  channels: string[],                  // ordered; empty → auth.communication.defaultChannels
  senders?: string[],                  // per-channel override
  recipients: string[],                // raw values OR entity ids (user:…/lead:…) —
                                       // resolved via parent's channels array, filtered
                                       // by entity_channel.type = <current channel>, verified=true
  template: string | TemplateBuilder,  // channel-less path; dispatcher prepends <channel>/
  templateData: Record<string, unknown> // includes tenant context + locale — no sensitive data
})
```

**Rules:**

- Never publish `send_email`/`send_sms` directly — reserved for the dispatcher.
- Tenant context (`systemSlug`, `companyId`, `actorId`, `actionKey`/`eventKey`,
  `occurredAt`, `actorName`, `companyName`, `systemName`, `locale`) travels
  **inside** `templateData`.
- `channels` is ordered; dispatcher picks the first channel whose handler
  renders + delivers. On a recoverable failure
  (`{delivered:false, reason: no-recipients|unknown-type|template-missing|provider-error}`)
  the handler dispatches to the next channel.
- No sensitive data in `templateData` or `verification_request.payload`. i18n
  keys, display names, resource keys, URLs, timestamps only.

**Dispatcher (`send_communication` handler):**

1. Resolve `channels` (fallback to core setting).
2. Pick first registered channel; publish `send_<channel>` with
   `{channel, channelFallback, …payload}`.
3. Per-channel handler, on recoverable failure, publishes `send_<fallback[0]>`
   with shortened tail.
4. All channels exhausted → delivery marked `dead`.

**Per-channel handler** (e.g. `send_email`, `send_sms`, subframework
`send_push`/`send_webhook`/`send_phone`):

1. Resolve locale (§2.3).
2. Resolve recipients. For `user:…`/`lead:…` ids: FETCH parent's `channels`
   array, filter `type=<channel> AND verified=true`, use `value`. If none →
   `{delivered:false, reason:"no-recipients"}`.
3. Resolve senders (`payload.senders` → `communication.<channel>.senders`
   setting).
4. Resolve template: string path →
   `server/utils/communication/templates/<channel>/<path>.ts`; `TemplateBuilder`
   → call with `(senders, recipients, templateData, channel)`.
5. Render + deliver via provider configured through core settings.
6. Return `{delivered:true}` or a recoverable reason.

The `entity_channel.type` **always matches the delivery channel name** —
`send_sms` resolves rows of type `"sms"`, `send_email` of type `"email"`, etc.
Phone and SMS are distinct channel rows.

### 5.3 Canonical template families

Core ships exactly two template builders per channel — registered as
`TemplateBuilder`s (`human-confirmation`, `notification`). All core
communications funnel through these. Frameworks register additional builders
through the same API.

| Family               | Used for                                                                                                                                                                      | Required `templateData` fields                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `human-confirmation` | Actions requiring a click (register, password reset/change, channel add, 2FA enable/disable, login fallback, lead update, tenant invite) — backed by a `verification_request` | `actionKey`, `confirmationLink`, `occurredAt`; optional `actorName`, `companyName`, `systemName`, `expiryMinutes`                                       |
| `notification`       | Informational events (payment outcomes, auto-recharge stages, credit/op-count alerts, pending/expired payments, subscription status changes, framework events)                | `eventKey`, `occurredAt`; optional `actorName`, `companyName`, `systemName`, `resources[]`, `value {amount,currency}`, `invoiceUrl`, `ctaKey`, `ctaUrl` |

**Tenant display conventions in `templateData`:**

| Context                      | actorName           | companyName  | systemName  |
| ---------------------------- | ------------------- | ------------ | ----------- |
| Authenticated user in tenant | profile.name        | company.name | system.name |
| Authenticated user in core   | profile.name        | omit         | omit        |
| Anonymous (public forms)     | omit                | when known   | when known  |
| Automatic (jobs/workers)     | `common.system` key | when known   | when known  |
| Superuser                    | superuser name      | omit         | omit        |

### 5.4 Template path convention & layout

Static templates: `server/utils/communication/templates/<channel>/<path>.ts`.
The `template` field is channel-less; dispatcher prepends `<channel>/`.

Each channel ships a shared `layout.ts` that wraps the rendered body. **Email
layout is table-based, mobile-first, 600px max, inline CSS only, no webfonts/JS,
hardcoded brand colors (email clients can't resolve CSS vars), `color-scheme` +
dark-mode media query, preheader, tenant banner at top.** **SMS layout**
collapses to `[systemName] actorName · actionKey/eventKey · link`.

Body sections (both families): tenant banner → hero icon → title
(`t(actionKey)`/`t(eventKey)`) → fixed summary sentence → facts card
(`occurredAt` + family-specific fields) → CTA
(`t("templates.humanConfirmation.action") → confirmationLink` or
`t(ctaKey) → ctaUrl`) → footer (`app.name`, support, recipient disclaimer).

---

## 6. File Storage & Access

### 6.1 Storage model

All data and metadata live inside `@hviana/surreal-fs`. Path pattern:

```
[companyId, systemSlug, userId, ...category, fileUuid, fileName]
```

Position-dependent: indices 0/1/2 encode `companyId`/`systemSlug`/`userId`.
`fileUuid` is **frontend-generated** — new file → new `crypto.randomUUID()`;
replacement → reuse existing UUID for atomic overwrite.

**Metadata** on `fs.save({metadata})`: `companyId`, `systemSlug`, `userId`,
`category`, `fileName`, `fileUuid`, `uri`, `sizeBytes`, `mimeType`, optional
`description`, `createdAt`. **There is no separate `file_metadata` table.**

### 6.2 Upload route (`POST /api/files/upload`)

One route, one flow — anonymous vs authenticated differ only in the tenant
values, not in the code path.

1. `withAuth` populates `ctx.tenant`/`ctx.claims` (anonymous synthesized per
   §2.5).
2. Parse FormData (`file`, `systemSlug`, `category` JSON array, `fileUuid`,
   optional `description`).
3. `companyId = ctx.tenant.companyId`; `userId = ctx.claims?.actorId ?? "0"`;
   `systemSlug` from FormData.
4. Call `checkFileAccess({operation:"upload",…})` (§6.4). On denial → 403.
5. Stream via `file.stream()` into
   `fs.save({path, content, metadata, control})`. **Never buffer into memory.**
6. `control` callback does all validation inside surreal-fs (leveraging its
   concurrency maps): max concurrent uploads (`resolveMaxConcurrentUploads` →
   core setting fallback → unlimited); upload bandwidth divided across active
   tenant uploads; `maxFileSizeBytes` and `allowedExtensions` from file-access
   guard result.
7. If path already existed (same UUID = replacement), call
   `FileCacheManager.evict()` on the resolved cache context.
8. Return `{uri, fileUuid, fileName, sizeBytes, mimeType}`.

### 6.3 Download route (`GET /api/files/download?uri=…[&token=…]`)

Stream-first, cache-aware — always streams; cache hit skips surreal-fs.

1. `path = fs.URIComponentToPath(uri)`; `companyId=path[0]`,
   `systemSlug=path[1]`.
2. **Token resolution.** `?token=…` is decoded independently (JWT →
   `verifyTenantToken`); absent → middleware `ctx.tenant`. Tenant drives
   access + cache context.
3. `checkFileAccess({operation:"download",…})` → 403 on denial.
4. **Cache HIT** → return `Uint8Array`-backed `Response` with stored `mimeType`.
   Cache MISS → `fs.read({path, control})`.
5. `control` mirrors upload: concurrent downloads + bandwidth resolved from
   guards → core settings → unlimited.
6. `mimeType` from `file.metadata.mimeType`; `fileName` from metadata. Headers:
   `Content-Type`, `Content-Disposition`, `Content-Length`. **Never invent
   mime-type maps** — metadata is always available.
7. **Background cache insertion (non-blocking, deduplicated):** tee the stream —
   one branch serves client, the other goes through `SurrealFS.readStream()`
   into a `Uint8Array` and into the cache. A URI set tracks in-flight
   insertions; duplicate concurrent requests stream without tee.

### 6.4 File access control

Rules stored in `file_access` (§3.4). Each rule has a glob-like
`categoryPattern` (`*` → `[^/]+`) compiled to a `RegExp` at cache load time
(cache slug/name `core`/`file-access`). Independent `download` and `upload`
sections, each with:

| Toggle (independent) | Check                           |
| -------------------- | ------------------------------- |
| `isolateSystem`      | `tenant.systemSlug === path[1]` |
| `isolateCompany`     | `tenant.companyId === path[0]`  |
| `isolateUser`        | `claims.actorId === path[2]`    |

- All off → anonymous access (no auth required).
- Any on → auth required; enabled checks AND-combined.
- Superuser or `*` permission always passes.
- `permissions` non-empty → actor needs ≥1; empty → tenant isolation only.
- Upload section additionally carries `maxFileSizeMB` (optional float) and
  `allowedExtensions` (array without dots; empty = all).

**`checkFileAccess` resolution:**

1. No rules exist → allow (backward compatible).
2. For each rule matching the category path, check the op-specific section.
3. ANY matching rule allows →
   `{allowed:true, maxFileSizeBytes?, allowedExtensions?}`.
4. Matching rules but none allow → `{allowed:false}`.
5. No matching rules → allow.

Upload result aggregates **most-restrictive** bounds: smallest non-null
`maxFileSizeMB` across matching rules (→ bytes); intersection of non-empty
`allowedExtensions` arrays.

**Default seeded rules** (`004_default_file_access.ts`) establish pattern:
company logos (anonymous download / auth upload), user avatars
(company-isolated), lead avatars (anonymous download / auth upload). Each rule
also caps upload size + extensions.

Mutations call `updateCache("core","file-access")`; `Core.reload()` also clears
it.

---

## 7. Billing, Credits, Subscriptions

### 7.1 Plan shape (rule-bearing)

| Field                                         | Meaning / rule                                 |
| --------------------------------------------- | ---------------------------------------------- |
| `price`, `currency`, `recurrenceDays`         | Recurring billing. Price 0 = free.             |
| `benefits[]`                                  | i18n keys (display)                            |
| `permissions[]`                               | Permission tokens granted by plan              |
| `entityLimits?: object FLEXIBLE`              | `{ entityName: count }`                        |
| `apiRateLimit`                                | Requests/min, distributed across active actors |
| `storageLimitBytes`                           | Per tenant                                     |
| `fileCacheLimitBytes`                         | Per tenant (default 20 MB)                     |
| `planCredits`                                 | Renewable period credits                       |
| `maxConcurrentDownloads/Uploads`              | 0 = unlimited                                  |
| `maxDownloadBandwidthMB/maxUploadBandwidthMB` | 0 = unlimited                                  |
| `maxOperationCount?: object FLEXIBLE`         | `{ resourceKey: count }` per billing period    |
| `isActive`                                    | Listed on billing/onboarding                   |

### 7.2 Subscription contract

```ts
interface Subscription {
  id: string;
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId?: string; // optional for free plans
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId?: string; // single-voucher invariant
  remainingPlanCredits: number; // resets on renewal
  remainingOperationCount?: Record<string, number>; // per-resourceKey; resets on renewal
  creditAlertSent: boolean; // one-shot
  operationCountAlertSent?: Record<string, boolean>; // per-resourceKey one-shot
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number;
  autoRechargeInProgress: boolean;
  retryPaymentInProgress: boolean; // past_due retry guard
  createdAt: string;
}
```

### 7.3 Credit deduction algorithm (one batched query)

`consumeCredits({resourceKey, amount, companyId, systemId})`:

1. Load active subscription + purchased credit balance.
2. **Per-resourceKey operation-count cap.**
   `remaining = subscription.remainingOperationCount[resourceKey]`; effective
   cap via `resolveMaxOperationCount`. If cap non-zero and remaining=0 → reject
   `{success:false, source:"operationLimit"}`; if
   `operationCountAlertSent[resourceKey]` is falsy, publish a `notification`
   with `eventKey="billing.event.operationCountAlert"` and set flag true. No
   alert or auto-recharge for this path.
3. **Actor-level op cap.** If `actorType ∈ {api_token, connected_app}`, resolve
   the actor's `maxOperationCount[resourceKey]`. If non-zero, count the actor's
   `credit_expense` for this key in the current period; if ≥ cap → reject same
   way.
4. `total = remainingPlanCredits + purchased`. If `total < amount`:
   - `autoRechargeEnabled && !autoRechargeInProgress` → set flag true; publish
     `trigger_auto_recharge`; return `{success:false, source:"insufficient"}`.
   - Else: if `creditAlertSent=false`, publish `notification` with
     `eventKey="billing.event.insufficientCredit"`, set flag true. Return
     insufficient.
5. Decrement: plan credits first, then purchased. UPSERT `credit_expense`
   incrementing `amount` and `count` with `actorId`. If
   `remainingOperationCount[resourceKey] > 0`, decrement by 1 in the same batch.
   Return `{success:true, source:"plan"|"purchased"}`.

### 7.4 Alert reset rules

| Flag                      | Reset by                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `creditAlertSent`         | `purchase_credits` success; plan renewal                                                 |
| `operationCountAlertSent` | Plan renewal (whole map → `{}`); `apply_voucher` when a voucher modifier lifts a key > 0 |

### 7.5 Payment ledger

Unified `payment` table:
`{kind: "recurring"|"credits"|"auto-recharge", status: "pending"|"completed"|"failed"|"expired", amount, currency, paymentMethodId, transactionId?, invoiceUrl?, failureReason?, continuityData?: object FLEXIBLE, expiresAt?: datetime, createdAt}`.
Every `process_payment` invocation creates a `pending` row before charging and
updates it to terminal state.

### 7.6 Async (deferred) payments — PIX / bank slips / crypto

When `IPaymentProvider.charge` returns a `PaymentResult` with
`expiresInSeconds` + `continuityData`:

1. `payment` stays `pending`; `continuityData` + `expiresAt` persisted;
   `payment-pending` notification sent with continuation data.
2. Provider webhook → `POST /api/public/webhook/payment` (generic scaffold;
   adapter layer handles signatures). Publishes `payment_async_completed` →
   `resolve_async_payment` handler applies the same effects as the synchronous
   branch. **Idempotent** on `transactionId` — already-terminal payments are
   acknowledged (200) and ignored.
3. Expiry job every 15 min: `WHERE status="pending" AND expiresAt <= now()` →
   mark `expired`, cascade to `credit_purchase`, clear re-entrancy flags, send
   `payment-expired` notification.
4. Both the webhook and the expiry job mutate with `WHERE status="pending"` —
   whichever runs first wins.

### 7.7 Voucher invariants

- **Single voucher** per subscription (`subscription.voucherId`).
  `apply_voucher` replaces any existing voucher atomically; no stacking, no
  audit row.
- **Scope:** `applicableCompanyIds` empty = universal; `applicablePlanIds` empty
  = all plans. Non-empty lists must include the target.
- **Modifiers** are signed integers/objects: `priceModifier`,
  `apiRateLimitModifier`, `storageLimitModifier`, `fileCacheLimitModifier`,
  `entityLimitModifiers`, `creditModifier`, concurrent-transfer modifiers,
  bandwidth modifiers, `maxOperationCountModifier` (per-resourceKey map).
  Effective value clamped to ≥ 0.
- **Auto-removal cascade on voucher edit.** `PUT /api/core/vouchers` runs one
  batched query: update voucher → find subscriptions where
  `voucherId=this AND subscription.planId NOT IN new applicablePlanIds` → clear
  `voucherId=NONE`. Then `Core.reload()` + `evictAllSubscriptions()`. No email
  sent; billing page reloads show the change.
- **Plan change** cancels the old subscription (voucher reference dropped with
  it); new subscription starts `voucherId=NONE`.
- On apply: if `creditModifier != 0` adjust `remainingPlanCredits`; if
  `maxOperationCountModifier` has non-zero keys adjust `remainingOperationCount`
  per key (clamped ≥ 0) — in the same batched query.

### 7.8 Billing actions (`POST /api/billing`)

Every mutation ends with `Core.reloadSubscription(companyId, systemId)`.

| Action                       | Rule-bearing behavior                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe`                  | Idempotent `company_system` create (existence-check, never raw CREATE on unique key). Cancel prior active subscription in same batch. New subscription with `remainingPlanCredits=plan.planCredits`, `remainingOperationCount=resolveAllOperationCounts()`. Create missing `user_company_system` with `roles:["admin"]` for owner. Paid plan without payment method → validation error. |
| `cancel`                     | `status="cancelled"`. Never deletes `company_system`.                                                                                                                                                                                                                                                                                                                                   |
| `add_payment_method`         | Create `address` first, then `payment_method` linked. First method → `isDefault=true`.                                                                                                                                                                                                                                                                                                  |
| `set_default_payment_method` | Unset all, set target. Single batch.                                                                                                                                                                                                                                                                                                                                                    |
| `remove_payment_method`      | Delete method + its address. Promote next available if default.                                                                                                                                                                                                                                                                                                                         |
| `purchase_credits`           | `credit_purchase` pending → `payment_due` → `process_payment`. On success: credit balance + `notification paymentSuccess.credits` + reset `creditAlertSent`. On failure: `notification paymentFailure.credits`.                                                                                                                                                                         |
| `set_auto_recharge`          | Enable: `amount ≥ billing.autoRecharge.minAmount`; default payment method required. Disable: reset `autoRechargeAmount=0` AND `autoRechargeInProgress=false`.                                                                                                                                                                                                                           |
| `apply_voucher`              | Validate + apply per §7.7.                                                                                                                                                                                                                                                                                                                                                              |
| `retry_payment`              | Only when `past_due`. Guard via `retryPaymentInProgress`. Publishes `payment_due` with `purpose="retry"`.                                                                                                                                                                                                                                                                               |

### 7.9 Jobs

- **`recurring-billing`** — periodic under system tenant.
  `SELECT subscription WHERE status="active" AND currentPeriodEnd <= now()` →
  publish `process_payment` per row. Success: advance period, reset credits
  (`plan.planCredits + voucher.creditModifier`), reset ops map, reset alert
  flags, clear `retryPaymentInProgress`, create completed `payment`, notify
  `paymentSuccess.recurring`. Failure: `status="past_due"`, create failed
  `payment`, notify `paymentFailure.recurring`.
- **`expire-pending-payments`** — every 15 min; §7.6.
- **`token-cleanup`** — daily; hard-delete `api_token` with
  `revokedAt > 90 days`; orphaned `connected_app` cleanup.

### 7.10 Auto-recharge handler (`auto_recharge`)

Runs under a synthesized subscription tenant (system-scoped). Steps: verify flag
still `true`; load default payment method (missing → notify
`paymentFailure.auto-recharge` + clear flag); notify `autoRechargeStarted`;
create `credit_purchase` pending with `purpose="auto-recharge"`; publish
`payment_due`. Terminal branches (success/fail in `process_payment`) clear
`autoRechargeInProgress`. Amount capped by `billing.autoRecharge.maxAmount`.
Idempotency key: `subscriptionId + currentPeriodStart + monotonic counter`.

### 7.11 Spend limits

Users, `api_token`, and `connected_app` may carry `monthlySpendLimit`. Before
any chargeable op, `current_month_usage + cost ≤ monthlySpendLimit`.

---

## 8. Authentication & Identity

### 8.1 Token architecture

The only stored bearer is a short-lived **System API Token** — a JWT with claims
`{ tenant, actorType, actorId, exchangeable, exp, iat }`. Frontend stores the
opaque string, never decodes it. All `fetch()` wrappers set
`Authorization: Bearer <token>`.

Refresh via `/api/auth/refresh` (extension — actor must still be in validity
cache; cold-start, logout, role change, exchange → refresh fails with
`auth.error.tokenRevoked`).

### 8.2 Account-approval invariant

An account (user/lead) is "approved" iff its `channels` array contains **≥1
verified `entity_channel`**. There are no identity fields on `user`/`lead`
themselves. `profile.recovery_channels` does **not** satisfy this invariant (it
is recovery-only — §3.3).

### 8.3 Registration

1. Payload: password + `channels: {type,value}[]` (≥1) + `termsAccepted=true` +
   bot token.
2. Conflict check: reject on any submitted `(type,value)` that matches a
   verified channel owned by another user, or an unverified channel with an
   active confirmation window. **Abandoned accounts** (no verified channel + no
   pending confirmation) are hard-deleted in the same batched query before the
   new user is created.
3. Hash password inside SurrealDB. Create one `entity_channel` per channel
   (`verified=false`), a `profile`, and the `user` referencing both — one
   batched query.
4. For every channel type in `auth.communication.defaultChannels`, open a
   `verification_request(actionKey="auth.action.register", payload={channelIds})`
   via `communicationGuard`.
5. Publish **one** `send_communication` with
   `channels = submitted types (ordered by user preference, then core default)`,
   `recipients = [user.id]`, `template = "human-confirmation"`,
   `actionKey="auth.action.register"`.
6. Login blocked until ≥1 channel flips to verified.

### 8.4 Login

1. Bot protection + auth rate limit.
2. Resolve user: find user whose `channels` has a **verified** `entity_channel`
   with matching `value`. Mismatch → `auth.error.invalidCredentials`.
3. `crypto::argon2::compare`. Mismatch → same error key.
4. If no verified channel exists (edge race) → `auth.error.notVerified`.
5. **2FA gate** (§8.8): no 2FA → proceed. 2FA enabled → accept TOTP code, OR
   accept confirmation of a `"auth.action.loginFallback"` verification, OR
   reject with `auth.error.twoFactorRequired`.
6. Issue JWT (short-lived; extended by `auth.token.expiry.stayLoggedIn.hours`
   when `stayLoggedIn`). `rememberActor(tenant, user.id)`.

### 8.5 Post-login routing & onboarding

| State                                | Destination                                                           |
| ------------------------------------ | --------------------------------------------------------------------- |
| Superuser                            | `/systems` (core panel)                                               |
| No companies                         | `/onboarding/company`                                                 |
| Companies but no active subscription | `/onboarding/system` (2-step: system → plan)                          |
| Onboarding complete                  | `/entry` (spinner-only landing; `(app)` layout resolves initial page) |

### 8.6 Token exchange (`POST /api/auth/exchange`)

The **sole** context-change path. Body `{companyId, systemId}`.

1. `withAuth` already verified. Reject if `claims.actorType !== "user"` (403;
   API/connected-app tokens are bound for life).
2. Verify user still in target `company_user` + `user_company_system`. Fail
   → 403.
3. Load roles from that `user_company_system`. Resolve `systemSlug`.
4. Issue new JWT with the new tenant, using the remaining lifetime of the
   previous token.
5. `forgetActor(oldTenant, user.id)` + `rememberActor(newTenant, user.id)`. Old
   JWT now fails immediately.

**Superuser bypass.** When `claims.roles` contains `"superuser"`, skip
membership check. Verify target `company_system` exists. Issue the new JWT with
`roles:["admin"]`, `permissions:["*"]`. No `user_company_system` row created.
This is the sole mechanism for a superuser to enter a tenant (exposed via the
Companies admin page "Access" button).

### 8.7 Password & channel changes

- **Password change (authenticated)** `POST /api/auth/password-change`: verify
  `currentPassword`; validate `newPassword`; compute the new hash inside
  SurrealDB; open
  `verification_request(actionKey="auth.action.passwordChange", payload={newPasswordHash})`
  — **never the plaintext**. `send_communication human-confirmation`.
  Confirmation link hits `/api/auth/verify` which writes `passwordHash` in one
  batched query.
- **Forgot password (public)** — identical data flow,
  `actionKey="auth.action.passwordReset"`. Anti-enumeration: generic success on
  any block/miss.
- **Channel lifecycle** (user.channels / lead.channels):
  - **Add** `POST /api/entity-channels`: create
    `entity_channel(verified=false)` + append id to parent's `channels` array in
    one batch; open
    `verification_request(actionKey="auth.action.entityChannelAdd")`.
  - **Verify**: confirmation link → `POST /api/auth/verify` flips channel(s) to
    verified.
  - **Change**: cannot mutate verified `value`; user adds new + deletes old.
  - **Delete**: allowed only if unverified, OR if ≥1 other verified channel of a
    `requiredTypes` entry remains.
  - **Resend**: `?action=resend-verification` (gated by `communicationGuard`).
- **Account recovery** `/account-recovery` — accepts verified value from
  `user.channels` **or** `profile.recovery_channels`.
  `profile.recovery_channels` entries are added + verified through their own
  `actionKey="auth.action.recoveryChannelAdd"` flow and are never used outside
  account recovery.

### 8.8 Two-factor authentication (user-level only)

Always per-user. There is no global 2FA toggle. TOTP secrets are sensitive —
`user.twoFactorSecret` and `user.pendingTwoFactorSecret` always store AES-GCM
envelopes (§4.7).

**Enable/disable** `POST /api/auth/two-factor`:

- `setup-totp` → generate secret server-side; return
  `{provisioningUri, qrPayload}` (no PII).
- `confirm-totp {code}` → verify code;
  `communicationGuard(actionKey="auth.action.twoFactorEnable", payload={twoFactorSecret})`.
  `send_communication human-confirmation`. The flip `twoFactorEnabled=true`
  happens **only** when the confirmation link is clicked.
- `disable` → `communicationGuard(actionKey="auth.action.twoFactorDisable")`.
  Flip on confirm.

**Verified-channel fallback at login** `POST /api/auth/two-factor/login-link`:
authenticates by `(identifier, password)` (unauthenticated endpoint);
`communicationGuard(actionKey="auth.action.loginFallback", payload={identifier, stayLoggedIn})`
— **never** password/hash. Confirmation link returns a fresh System API Token
through the verify endpoint. Always available even when TOTP is configured —
losing the authenticator never locks the user out.

### 8.9 OAuth (social login, when `auth.oauth.providers` is non-empty)

Identity model lives in `oauth_identity` rows keyed by
`(provider, providerUserId)`. A user may have many linked providers; a provider
account links to exactly one user. **Re-identification always matches on stable
provider subject, never on email.**

Callback:

- Match `(provider, providerUserId)` → hit: load user, issue token.
- Miss but verified `entity_channel` of type `"email"` exists with
  `value = provider email` → create `oauth_identity` linking provider account to
  existing user (same batched query as token issue).
- Miss entirely → create user + verified email channel + used
  `verification_request` + `oauth_identity`, all in one batched query.
- Linking under an authenticated session: if resolved user ≠ authenticated user
  → reject `auth.error.oauthAccountLinkedElsewhere`.
- Unlink: `DELETE oauth_identity`. Reject with
  `auth.error.lastAuthenticationMethod` if removing leaves zero auth paths.

Provider tokens/scopes, if ever stored, go on `oauth_identity`,
AES-GCM-encrypted.

### 8.10 OAuth server (connected apps — platform as provider)

**Not social login.** Third-party apps request scoped access to a user's data.

Authorization URL:
`/oauth/authorize?client_name=&permissions=&system_slug=&redirect_origin=`.

Flow:

1. External app opens popup.
2. Auth page: unauthenticated → redirect to `/login?oauth=1&…`, return here
   after login.
3. Authenticated: show app name + company selector + requested permissions +
   Authorize/Cancel.
4. **Authorize** → `POST /api/auth/oauth/authorize`: resolve systemId, create
   `connected_app` + linked `api_token` (`exchangeable:false`, embedded tenant,
   token id = universal actor id). Return JWT bearer **once**. Page posts
   `{token}` via `postMessage(redirectOrigin)` and closes.
5. **Cancel** → `postMessage({error:"access_denied"})`.

### 8.11 Token revocation lifecycle

- `api_token.revokedAt` is the **durable boot-time filter**; runtime authority
  is the actor-validity cache.
- Revocation writes `revokedAt=now()` + `forgetActor(tenant, token.id)` in the
  same handler.
- Role/membership change → `forgetActor(tenant, userId)`; next request forces
  re-login.
- Hard-deleted user → `forgetActor` across every tenant, evict api_tokens
  similarly.
- 90-day audit retention; `token-cleanup` then hard-deletes.

### 8.12 Security measures summary

| Measure               | Implementation                                                                      |
| --------------------- | ----------------------------------------------------------------------------------- |
| Auth rate limit       | `auth.rateLimit.perMinute` per IP (default 5)                                       |
| Bot protection        | `BotProtection` component + server-side token verification on login/register/forgot |
| Verification cooldown | `communicationGuard` (previous-not-expired + window-count)                          |
| Token expiry          | JWT `exp`; verification tokens via `auth.communication.expiry.minutes`              |
| 2FA                   | Per-user only; verified-channel fallback always available                           |

---

## 9. Configuration, Admin Panels & Public Surfaces

### 9.1 Route groups

| Group    | Purpose                                      | Rules                                                                                                                                                                                          |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root     | `/` (public homepage router)                 | Reads `?system=` → registry → system homepage; else `app.defaultSystem`; else core inline homepage                                                                                             |
| `(auth)` | Public auth surfaces + terms + OAuth consent | No sidebar; `?system=` preserved across links; `SystemBranding` top of forms                                                                                                                   |
| `(app)`  | Authenticated user workspace (scoped tenant) | Sidebar + `ProfileMenu`; onboarding guard on mount; cookie-persisted context                                                                                                                   |
| `(core)` | Superuser admin                              | Hardcoded core sidebar (Companies, Systems, Roles, Plans, Vouchers, Menus, Terms, Data Deletion, Settings, Front Settings, File Access). Sidebar **never** displays "Core" in `(app)` context. |

### 9.2 `(app)` layout rules

1. **Onboarding guard** on mount (see §8.5).
2. **Default context**: first company + its first subscribed system; persisted
   in `core_company`/`core_system` cookies.
3. **Sidebar branding**: system `logoUri` (resolved via download endpoint) +
   system `name`. No system yet → show spinner. Never "Core".
4. **Menu loading**: custom menus for the system (filtered by user roles +
   plan's hidden list) + **hardcoded shared defaults** (usage, billing, users,
   company-edit, connected-apps, tokens, connected-services) appended with
   `sortOrder` offset by `max(custom)+1`. Defaults always follow custom.
5. **Initial page rule**: first menu item with non-empty `componentName`
   (depth-first). Frontend navigates to `/<componentName>` on initial login,
   company switch, system switch. Login redirects to `/entry` first
   (spinner-only landing) to avoid loading a component before the layout
   resolves the route.
6. Company/system switch in `ProfileMenu` calls `useAuth().exchangeTenant(...)`
   — never mutate context state directly.

### 9.3 Public pages

- **Homepage** (`app/page.tsx`): `?system=` → registry lookup → `<Suspense>`
  system component. Else core inline.
- **Public system info**: `GET /api/public/system?slug=` or `?default=true`.
  Response: `{name, slug, logoUri, defaultLocale?, termsOfService?}` (terms
  resolved: system → generic → fallback i18n key).
- **Public front-core**: `GET /api/public/front-core` returns full
  `front_setting` key/value map.
- **Terms page** `(auth)/terms/page.tsx`: renders system branding + terms HTML
  from public system info + `LocaleSelector`.
- **Webhook**: `POST /api/public/webhook/payment` — generic scaffold (§7.6).
- **Public lead endpoint**: `POST /api/leads/public` — §9.7.

### 9.4 Superuser admin surfaces (all use shared primitives)

Every admin page uses `GenericList` + `FormModal` + standard buttons.
Per-concern rules:

| Concern          | Rule                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity forms     | All use `forwardRef` + `useImperativeHandle({getData, isValid})`. Compose subforms; never duplicate fields.                                                                                                                                              |
| Permissions      | Always via `MultiBadgeField` (`mode:"custom"` for authoring new tokens, `mode:"search"` for picking from server-defined sets).                                                                                                                           |
| Record pickers   | Always `SearchableSelectField` fetching the relevant API.                                                                                                                                                                                                |
| KV objects       | Always `DynamicKeyValueField` (never `<textarea>` with JSON). Applies to entity limits, op-count maps, settings editors.                                                                                                                                 |
| Settings editors | `server` and `front` have separate pages; both have a system-scope dropdown + "missing keys" banner + "Add all missing"; badge identifies the table.                                                                                                     |
| Menu editor      | Dedicated tree editor: inline "+" buttons (root + inside nodes) for creation (label only, no modal); edit modal for everything except hierarchy; drag-drop manages parent/order; "⚠" badge marks items missing required config.                          |
| Terms editor     | Generic fallback card at top + per-system list; large HTML textarea; system picker for new entries uses the same debounced search pattern as `DataDeletion`.                                                                                             |
| Data deletion    | Two debounced searches (company, system) + confirmation modal with awareness checkbox + password re-entry (argon2-compared). Deletes scoped rows + `fs.delete` under `{companyId}/{systemSlug}/`. Never deletes the `company` or `system` record itself. |
| File-access      | CRUD with shared name/pattern + Download/Upload sections (isolation toggles + permissions `MultiBadgeField`); Upload also has `maxFileSizeMB` + `allowedExtensions`.                                                                                     |
| Companies        | Read-only list + "Access" action (superuser bypass exchange → redirects to `/entry`). Filters: date range (chart only), system, plan, status. Bar chart with 4 revenue series (canceled/paid/projected/errors).                                          |

### 9.5 `(app)` user surfaces

Each uses shared primitives. Per-concern rules:

| Concern            | Rule                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users (admin)      | Invite flow: existing user (channel match) → no new account, creates/updates `user_company_system` + notification with `eventKey="auth.event.tenantInvite"`. Admin invariant enforced in same batched query on role-update and user-remove (last-admin rejection).                                                                                                               |
| Tokens             | Create modal: name, description, permissions (`MultiBadgeField mode:"search"` aggregating from system roles), `monthlySpendLimit`, `maxOperationCount` (`DynamicKeyValueField`), `neverExpires` XOR `expiresAt`, `frontendUse` + required `frontendDomains` when on. Issued JWT shown **once** in a modal. Delete sets `revokedAt`.                                              |
| Connected apps     | No manual create; only via OAuth flow. Revoke deletes `connected_app` + sets `revokedAt` on linked `api_token` in one batch.                                                                                                                                                                                                                                                     |
| Connected services | List with search (FULLTEXT). "Connect service" button opens catalog modal (initially empty, expandable). Admin sees all users' services + user name; regular users see only their own. Delete with confirmation modal. Component: `ConnectedServicesPage`.                                                                                                                       |
| Billing            | Sections: Current Plan (with Cancel), Available Plans, Payment Methods, Credits (balance + per-resourceKey op count + purchase + history + auto-recharge toggle), Voucher (inline feedback, never global error), Past-due Retry (guarded by `retryPaymentInProgress`), Payment History (`GenericList` with `DateRangeFilter` ≤ 365 days). Pending-async banner polls every 30 s. |
| Usage              | Dual-mode (`tenant`/`core`). Tenant: Storage bar, File Cache bar, Credit Expenses column chart (`DateRangeFilter` ≤ 31 days) + summary table, Operation Count per-resourceKey bars. **No API-call metric.** Core mode (superuser only) adds filters (company/system/plan/actor) and dual-axis stacked chart with clickable columns.                                              |
| Profile            | Password change subform → §8.7. Entity channels managed via shared subform in `authenticated` mode. 2FA card (enable/disable flows per §8.8).                                                                                                                                                                                                                                    |

### 9.6 Plan cards (`variant: "billing" | "onboarding" | "core"`)

A shared card component is the **only** renderer of plans across billing,
onboarding, and core admin. Rich glassmorphism layout; emoji-prefixed limit
rows; per-resourceKey op-count rows translated via `t("billing.limits." + key)`;
`0`/absent key → `t("billing.limits.unlimited")`. Voucher-adjusted prices show
original strikethrough + effective value when voucher's `applicablePlanIds` is
empty or contains the plan; frontend effect is cosmetic, server-side charge calc
must also apply modifiers.

### 9.7 Lead public submission

`POST /api/leads/public` (bot-protected, no auth). Payload: `name` +
`channels[]` (≥1, unverified) + `profile` + `companyIds` + `systemSlug` +
`termsAccepted`. **Tags not accepted** (authenticated-only). New lead → create +
one `human-confirmation` (`actionKey="auth.action.leadRegister"`). Existing lead
(any channel match) → no direct write;
`verification_request(actionKey="auth.action.leadUpdate", payload=diff)` +
human-confirmation. Rate limit via `communicationGuard` → 429 when blocked.
System-specific routes (e.g. `/api/systems/<slug>/leads/public`) may delegate
here and add their own logic.

### 9.8 Terms / LGPD

- Resolution: `System.termsOfService` → `terms.generic` setting →
  `common.terms.fallback` i18n key.
- Checkpoints: `/register` (validates `termsAccepted`); public leads (same).
- **Data-tracking consent popup** — global, on every page (public +
  authenticated) until decided. Cookie `core_data_tracking_consent` with 6-month
  lifetime. Frontend code that captures characteristics listed in
  `front.dataTracking.trackedCharacteristics` MUST gate on
  `useDataTrackingConsent().accepted`. The list starts empty and is expanded
  additively.

---

## 10. Frontend Architecture & UI Primitives

### 10.1 Hooks (`src/hooks/`)

| Hook               | Role                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useDebounce`      | Debounced value                                                                                                                                                                                     |
| `useAuth`          | Context+Provider. Holds opaque token. `login`, `logout`, `refresh`, `exchangeTenant`. Decodes tenant once via `useMemo`. **Single enforcement point**: every fetch wrapper reads `token` from here. |
| `useLiveQuery`     | `LIVE SELECT` wrapper, manages WebSocket                                                                                                                                                            |
| `useSystemContext` | Thin wrapper over `useAuth` exposing tenant + companies/systems + `switchCompany`/`switchSystem` (which call `exchangeTenant`)                                                                      |
| `useLocale`        | `locale`, `setLocale`, `t`, `supportedLocales`                                                                                                                                                      |
| `useFrontCore`     | Context+Provider. Lazily loads FrontCore; synchronous `get(key)`; reloads on live-query signal                                                                                                      |
| `usePublicSystem`  | Public system info fetch for homepage/auth branding                                                                                                                                                 |

**Hook rules** (violations are bugs):

1. **Shared state → Context + Provider** mounted once in the root layout.
   Independent state → local hooks OK.
2. **Exhaustive deps** on every `useCallback`/`useEffect`. Inline-constructed
   deps (objects/arrays) stabilized with `useMemo`.
3. **Async effects with cancellation guard**: `let cancelled=false`; cleanup
   sets true; all `setState` guarded by `!cancelled`.
4. **No fire-and-forget fetches** at hook top level. Always inside `useEffect`
   or a `useCallback` consumed by `useEffect`.
5. **Loading guards** on authenticated callbacks: early-return when token is
   null.
6. **Derived values from context** use `useMemo` with the source as dependency.
7. Provider files with JSX are `.tsx`; pure-logic hooks are `.ts`.

### 10.2 Single-token rule

The frontend stores **only** the opaque JWT string. No React context or hook
stores `companyId`/`systemId`/`roles`/`permissions` independently — derived from
`useAuth().tenant`. Every fetch wrapper attaches
`Authorization: Bearer <token>`. This is the one enforcement point that keeps
the frontend free of scattered tenant state.

### 10.3 Shared component categories

One authoritative implementation per category. New needs extend with
props/variants; cross-page duplication is forbidden.

| Category           | Contract / purpose                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action buttons     | Create / Edit / Delete / generic submit. Consistent styling, confirmation dialogs, embedded `Spinner`.                                                                                                                                                                |
| Spinner            | `size: "sm"                                                                                                                                                                                                                                                           |
| Modal & form modal | Form modal orchestrates subform collection, validation, submission, error surfacing, spinner state. Never hand-roll a modal form.                                                                                                                                     |
| Generic list       | Configurable `fieldMap`, `renderItem`, `controlButtons`, `actionComponents`, cursor pagination, debounced search, filters, empty state. Every entity listing uses this.                                                                                               |
| Field components   | `FileUploadField`, `SearchableSelectField`, `DynamicKeyValueField`, `MultiBadgeField`, `TagSearch`. Plain `<input>` reserved for free-form strings only. See field-selection policy below.                                                                            |
| Subforms           | One per composable DB entity (`profile`, `address`, `entity_channel` list, credit card, name+desc, etc.). Each exposes `{getData(), isValid()}` via `useImperativeHandle`. Forms are assembled from subforms. **Never duplicate a subform's fields in another form.** |
| List filters       | Search (debounced), filter dropdown, date range (with `maxRangeDays`), filter badge.                                                                                                                                                                                  |
| Data export        | `DownloadData` — XLSX via shared helper with embedded spinner and error handling.                                                                                                                                                                                     |
| Translated badge   | Resolves identifier tokens via §2.3.1 structure. Operator mode shows raw + translated; user mode (`compact`) shows translation only. Palette fixed per kind. `MultiBadgeField` accepts a `renderBadge` prop that returns this.                                        |
| Cookie consent     | Global popup gated on `core_data_tracking_consent` cookie (6-month TTL). Hook `useDataTrackingConsent()`. Mounted once above every route group.                                                                                                                       |
| Bot protection     | CAPTCHA / challenge widget on login/register/forgot; backend verifies token.                                                                                                                                                                                          |
| System branding    | Logo + name block used on auth / public surfaces.                                                                                                                                                                                                                     |
| Layout chrome      | Sidebar (starts hidden, hamburger, outside-click close), recursive sidebar menu item (unlimited depth), sidebar search (debounced), profile menu (avatar, company selector, system selector, profile link, logout).                                                   |
| Plan card          | §9.6.                                                                                                                                                                                                                                                                 |
| Charts             | `react-chartjs-2` inside glassmorphism cards.                                                                                                                                                                                                                         |

### 10.4 Field-selection policy

| Data type                                              | Required component                                          | Notes                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------ |
| Free multi-value strings (permissions, tags, benefits) | `MultiBadgeField mode:"custom"`                             | Type + Enter                                           |
| Multi-value from backend set (roles, plan IDs)         | `MultiBadgeField mode:"search"` with `fetchFn`              | Cannot invent values                                   |
| Single/multi record reference                          | `SearchableSelectField`                                     | Debounced API search                                   |
| Static ≤ 6 options                                     | `<select>` OR `MultiBadgeField mode:"search" staticOptions` |                                                        |
| Key-value pairs                                        | `DynamicKeyValueField`                                      | Never JSON in `<textarea>`                             |
| File / image                                           | `FileUploadField`                                           | Never a plain URL input for uploads                    |
| Entity channels (email/phone/…) as a list              | `EntityChannelsSubform` (modes `authenticated` or `local`)  | Never hardcoded email/phone inputs for list collection |
| Single identifier (login, forgot, verify resend)       | Plain text input                                            | Resolves one existing verified channel                 |

### 10.5 Homepage registry

`src/components/systems/registry.ts` exports `registerHomePage(slug, loader)`
and `getHomePage(slug)`. Homepages live at
`src/components/systems/<slug>/HomePage.tsx`, receive no props, use `useLocale`,
link to `/login?system=<slug>`.

### 10.6 Payment contracts (client & server)

- **Client**
  `IClientPaymentProvider.tokenize(cardData, billingAddress) → {cardToken, cardMask}`
  (gateway-specific). Raw card data never crosses to the server.
- **Server**
  `IPaymentProvider.charge(amountCents, params) → PaymentResult { success, transactionId?, error?, invoiceUrl?, expiresInSeconds?, continuityData? }`.
  The async fields trigger the deferred lifecycle (§7.6).

---

## 11. Project File Layout

```
app/                            # Next.js App Router
├── globals.css                 # CSS vars only (§2.2)
├── layout.tsx                  # LocaleProvider, FrontCoreProvider, AuthProvider, CookieConsent
├── page.tsx                    # Public homepage router (?system=)
├── (auth)/                     # login, register, verify, forgot/reset password, account-recovery,
│                               # terms, oauth/authorize
├── (app)/                      # Onboarding, entry (spinner-only), [...slug]
├── (core)/                     # Superuser panel
└── api/
    ├── public/{system,front-core,webhook/payment}/
    ├── auth/{login,register,verify,forgot-password,reset-password,password-change,
    │         refresh,exchange,two-factor,two-factor/login-link,oauth/...}/
    ├── core/{systems,roles,plans,vouchers,menus,terms,companies,
    │         data-deletion,settings,settings/missing,front-settings,file-access}/
    ├── users, companies, companies/[id]/systems, billing, usage,
    ├── connected-apps, tokens, connected-services, entity-channels, leads, leads/public, tags,
    └── files/{upload,download}, systems/[slug]/...

src/
├── components/{shared,fields,subforms,core,systems/{registry.ts,[slug]}}
├── contracts/                  # isomorphic (no secrets)
├── i18n/                       # en/, pt-BR/, systems/<slug>.json
├── hooks/
└── lib/                        # formatters, validators (isomorphic),
                                # db/connection.ts (frontend WS),
                                # payment/ (client tokenization)

server/
├── db/
│   ├── connection.ts
│   ├── migrations/{runner.ts, *.surql, systems/[slug]/*.surql}
│   ├── seeds/{runner.ts, NNN_*.ts, systems/[slug]/*.ts}
│   ├── queries/, frontend-queries/
├── middleware/                 # compose, withAuth, withRateLimit, withPlanAccess, withEntityLimit
├── utils/                      # Core, FrontCore, cache, tenant, token, actor-validity,
│                               # rate-limiter, usage-tracker, credit-tracker, fs, cors, guards,
│                               # field-standardizer, field-validator, entity-deduplicator,
│                               # verification-guard, file-cache, file-access-cache,
│                               # file-access-guard, crypto, server-only,
│                               # communication/templates/<channel>/...,
│                               # payment/{interface,credit-card}
├── event-queue/{publisher,worker,registry,handlers/}
├── module-registry.ts
├── core-register.ts
└── jobs/{index, start-event-queue, recurring-billing, token-cleanup,
        expire-pending-payments}

systems/
├── index.ts                    # calls each system's register()
└── [slug]/{AGENTS.md?, register.ts}

frameworks/
├── index.ts                    # calls each framework's register()
└── [name]/{AGENTS.md, app/api/[name]/, src/{components/[name],contracts,i18n},
           server/{db/{migrations,queries}, utils}, public/[name]/}

public/systems/[slug]/logo.svg
database.json                   # backend DB credentials (git-ignored, server-only)
```

Adding a new system creates a matching subfolder in every structural tree listed
above (with `.gitkeep` where empty). Same for new frameworks.

---

## 12. Phased Roadmap

Each phase builds on the previous; nothing later violates earlier invariants.

1. **Foundation** — Next.js 16 strict; Tailwind 4.2 + CSS vars; isomorphic
   contracts; DB connection; migration + seed runners with all migrations;
   server-only guard; Core + FrontCore singletons + cache registry; i18n
   skeleton.
2. **Authentication** — `@panva/jose` token utils; rate limiter; `/api/auth/*` +
   entity_channel approval; bot protection; auth pages + terms checkpoint;
   `communicationGuard`; minimal event-queue with `send_communication`,
   `send_email`, and `human-confirmation`/`notification` builders; `useAuth`.
3. **Event queue** — publisher/registry/worker (claim, lease, backoff,
   dead-letter); `send_sms`; dispatcher fallback chain; per-channel layouts.
4. **Shared UI primitives** — Spinner, Modal, Locale, search, debounce,
   `GenericList`, action buttons, filters, `FormModal`, all fields
   (`FileUploadField`, `SearchableSelectField`, `DynamicKeyValueField`,
   `MultiBadgeField`), all subforms, `DownloadData`, `SystemBranding`,
   `TagSearch`, `TranslatedBadge`, `TranslatedBadgeList`, `CookieConsent`.
5. **Core admin** — middleware composer; core API routes; entity forms; menu
   tree editor; settings editors (both tables); terms editor; data deletion;
   public terms page.
6. **Multi-tenant user flow** — onboarding; company API; sidebar + profile
   menu + `useSystemContext`; `(app)` layout with system branding + menu loading
   rule.
7. **Billing & payments** — all billing actions; client/server payment
   interfaces; `BillingPage`; plan card (shared).
8. **Usage, storage, credits** — `credit_expense` + `credit-tracker`; storage
   reporting via `fs.readDir`; `GET /api/usage` (dual-mode); `UsagePage`
   (dual-mode). No API-call metric.
9. **Connected apps, tokens, users CRUD** — invite flow + admin invariant;
   tokens form with all flags; connected apps revoke path; OAuth popup flow;
   spend-limit enforcement.
10. **Live queries** — frontend WebSocket; `useLiveQuery`; frontend queries with
    `PERMISSIONS FOR select`.
11. **Recurring & async billing** — recurring-billing job; past-due/retry; async
    payment lifecycle + webhook + expiry job.

---

## 13. Technical Trade-offs

| Decision                                            | Rationale                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| SurrealDB HTTP (backend) + WS (frontend live only)  | Serverless-compatible; WS reserved for reactivity                                                         |
| In-memory rate limiter + actor-validity cache       | Per-instance; multi-instance needs a broadcast channel (API stays the same)                               |
| Cursor pagination only                              | Stable under concurrent writes, no size degradation                                                       |
| Event queue inside SurrealDB                        | One fewer infra dep; move to broker if throughput exceeds DB                                              |
| Argon2 inside the DB                                | Zero native modules in app code                                                                           |
| Tailwind-only + emojis                              | Design consistency + zero icon deps                                                                       |
| `@panva/jose` JWT                                   | Pure JS, runs everywhere                                                                                  |
| Token embeds full Tenant                            | Single source of context for frontend + backend; eliminates scattered IDs                                 |
| Separate `setting` / `front_setting` tables         | Physical guarantee that frontend bundles cannot leak server-only secrets                                  |
| Namespace-isolated subframeworks/systems            | No route/name collisions, no scope leakage; module registry is the only wiring                            |
| Two canonical template families                     | Every comms path funnels through `human-confirmation` or `notification` — no bespoke templates per action |
| Universal actor id = `api_token.id` (no token hash) | Uniform JWT verification across user sessions and API tokens; revocation lives in the validity cache      |

---

## 14. Required Workflow & Skills

Before completing any task, follow every item in `docs/agent-checklist.md`.

Project-specific skills live under `skills/`. Read the matching `SKILL.md`
before acting:

- **PRIORITY 1 — runs before every other skill:** confirming which layer (Core,
  subsystem, or framework) a request belongs to, and enumerating existing
  subsystems/frameworks dynamically → `skills/isolation-guard/SKILL.md`.
- Writing database query tests → `skills/test-db-queries/SKILL.md`.
- Writing route tests → `skills/test-routes/SKILL.md`.
- Driving the frontend with Playwright (local pages and absolute external URLs —
  OAuth consent, payment redirects, third-party callbacks) →
  `skills/test-frontend/SKILL.md`.
- Debugging or verifying any queue event (any handler, not just communications —
  includes a convenience path for `verification_request` + human-confirmation
  link delivery) → `skills/test-events/SKILL.md`.
- Dependency updates → `skills/check-library-updates/SKILL.md`.
- Iterative review of target until clean → `skills/review-code/SKILL.md`.
