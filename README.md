# Grex-ID — Multi-Tenant Platform

```bash
deno run dev:vinext
#deno run dev:build
#deno run dev:deploy
```

---

## AI Codebase Review Protocol

This document defines a **systematic, exhaustive review** of the entire codebase
against the `AGENTS.md` specification. The AI must execute every phase in order,
using the steps and checkpoints defined below. No phase may be skipped; within
each phase, every checkpoint must be verified before moving on.

### Guiding Principles

1. **AGENTS.md is the single source of truth.** Every rule in that document is
   load-bearing. If code contradicts it, the code is wrong.
2. **Never break existing functionality.** Changes must be tested — if the dev
   server is running, verify the affected flow still works after each batch of
   edits.
3. **One concern per commit.** Group related fixes (e.g., "fix all i18n
   violations in auth pages") so rollbacks are clean.
4. **Report before acting.** At the start of each phase, report findings. Only
   then apply fixes. If a fix is ambiguous, ask the user.

---

### Phase 0 — Pre-Flight Audit

**Goal:** Build a complete deviation map before touching any code.

| Step | Action | Output |
|------|--------|--------|
| 0.1 | Read `AGENTS.md` end-to-end. Create a checklist of every concrete rule (shalls, musts, nevers, always, only). | Numbered rule list |
| 0.2 | Inventory every file against the project structure map (§6). Flag missing `.gitkeep` files, missing directories, misplaced files. | Structural deviation list |
| 0.3 | Verify every migration file (§8) exists and its DDL matches the schema index table. Cross-check table names, field types, UNIQUE indexes, PERMISSIONS. | Schema deviation list |
| 0.4 | Verify every contract in `src/contracts/` matches the interfaces described in AGENTS.md (Tenant, TenantClaims, ApiToken, Subscription, Payment, FileMetadata, etc.). | Contract deviation list |
| 0.5 | Verify every seed file exists and seeds exactly the keys/values listed in §10.1.4 and §10.2.6. | Seed deviation list |

**Exit criterion:** A complete written report of all deviations. Present to the
user before proceeding.

---

### Phase 1 — Runtime Invariants (§1.1)

**Goal:** Verify every non-negotiable invariant is respected in practice.

| Step | Check | How |
|------|-------|-----|
| 1.1 | **Serverless runtime (§1.1.1).** No `node:*`, `Deno.*`, `Bun.*` imports anywhere. | `grep -r "from ['\"]node:" server/ src/` and similar patterns |
| 1.2 | **Mobile-first responsive UI (§1.1.2).** Every component renders correctly on small screens. | Visual inspection of components; check for hardcoded widths > mobile viewport |
| 1.3 | **Spinner on every AJAX (§1.1.3).** Every `fetch()` call renders `<Spinner />` at the action's origin. | Grep for all `fetch(` calls in `src/` and `client/`; verify each has a loading state with `<Spinner />` |
| 1.4 | **Searchable text fields use debounce (§1.1.4).** No un-debounced search inputs. | Grep for `onChange` on search-type inputs; verify `useDebounce` usage |
| 1.5 | **Tailwind-only styling (§1.1.5).** No custom CSS outside `:root` variables block in `globals.css`. Check `placeholder-white/30` on all inputs/textareas. | Read `globals.css`; grep for `<style`, `className=` with non-Tailwind, `placeholder-` patterns |
| 1.6 | **Emojis instead of icon libraries (§1.1.6).** No icon library imports (`lucide`, `heroicons`, `react-icons`, etc.). | `grep -r "icon" package.json` + grep imports in components |
| 1.7 | **All UI text uses i18n keys (§1.1.7).** No hardcoded English/Portuguese strings in TSX files. | Grep TSX files for literal strings in JSX text nodes, labels, placeholders, button text |
| 1.8 | **Backend never returns human-readable text (§1.1.8).** All API error shapes are `{ code, errors/message }` with i18n keys. | Grep route handlers for string literals in error responses |
| 1.9 | **Communication templates use i18n keys (§1.1.9).** Email/SMS templates call `t()`. | Read every template in `server/utils/communication/templates/` |
| 1.10 | **Compositional DB model (§1.1.10).** `profile` and `address` are separate tables linked via `record<>`. Create composable first, then parent. Update composable directly. Delete both. | Inspect queries that create/update users and companies |

**Fix approach:** For each violation, fix inline. If a pattern is widespread
(e.g., missing Spinners), fix all instances in one pass.

---

### Phase 2 — Tech Stack & Allowed Dependencies (§2)

| Step | Check |
|------|-------|
| 2.1 | Verify `package.json` dependencies match the allowed list exactly: `jsr:@hviana/surreal-fs`, `jsr:@panva/jose`, `npm:react-chartjs-2`, `npm:chart.js`, `npm:surrealdb`, `npm:xlsx`. Flag any unauthorized package. |
| 2.2 | Verify Next.js 16, SurrealDB 3.0 client, Tailwind 4.2, TypeScript strict mode. |
| 2.3 | Verify `tsconfig.json` has `"strict": true`. |

---

### Phase 3 — Visual Standard (§4)

| Step | Check |
|------|-------|
| 3.1 | `globals.css` contains **only** the `@import "tailwindcss"` and the `:root` CSS-variables block from §4. No other custom CSS. |
| 3.2 | All components use the specified Tailwind patterns: card glassmorphism (`backdrop-blur-md bg-white/5 border border-dashed …`), hover effects, gradient borders. |
| 3.3 | Color roles enforced: primary = `--color-primary-green`, accent = `--color-secondary-blue`, background = `--color-black`, borders = `--color-dark-gray`, secondary text = `--color-light-text`. |
| 3.4 | All inputs and textareas use `placeholder-white/30`. No `placeholder-[var(--color-light-text)]/50`. |
| 3.5 | Dark backgrounds, subtle gradients present across all pages. |

**Fix approach:** For each component that deviates, apply the standard Tailwind
classes from §4. Prioritize visual impact: cards, forms, sidebars, modals first.

---

### Phase 4 — Internationalization (§5)

| Step | Check |
|------|-------|
| 4.1 | **Structure (§5.1).** Verify `src/i18n/` has the exact file set: `en/` and `pt-BR/` each with `common.json`, `auth.json`, `core.json`, `billing.json`, `homepage.json`, `templates.json`, `validation.json`, `systems/{slug}.json`. |
| 4.2 | **`t()` contract (§5.2).** Verify `src/i18n/index.ts` exports a `t()` function matching the signature. Returns the key itself as fallback. |
| 4.3 | **Locale resolution (§5.3).** Verify `LocaleProvider.tsx` implements the full resolution chain: `core_locale` cookie → `navigator.languages` (two-pass: exact then prefix) → `defaultLocale` prop → `"en"`. No `navigator.language`. |
| 4.4 | **LocaleSelector (§5.5).** Exists, reads from `LocaleContext`, renders on every page. |
| 4.5 | **DB-stored i18n keys (§5.6).** Role names, plan names, menu labels, plan benefits stored as i18n keys (e.g., `"roles.admin.name"`) and resolved via `t()` at render time. |
| 4.6 | **Complete key coverage.** Every i18n key referenced in code exists in both `en` and `pt-BR` files. No missing keys. Verify `validation.json`, `templates.json`, `core.json` have all keys listed in §20.1. |
| 4.7 | **Template i18n.** Every template in `server/utils/communication/templates/` calls `t()` for all strings. No hardcoded English. |
| 4.8 | **PT-BR quality.** All Portuguese translations use correct grammar, accents (ã, é, ç, etc.), and natural phrasing. |

**Fix approach:** Add missing keys. Fix PT-BR translations. Replace all
hardcoded strings with `t()` calls.

---

### Phase 5 — Project File Structure (§6)

| Step | Check |
|------|-------|
| 5.1 | Every empty structural folder has a `.gitkeep`. |
| 5.2 | System-specific folders exist for every system: `src/components/systems/[slug]/`, `server/db/migrations/systems/[slug]/`, `server/db/queries/systems/[slug]/`, `server/db/frontend-queries/systems/[slug]/`, `server/event-queue/handlers/systems/[slug]/`, `app/api/systems/[slug]/`, `public/systems/[slug]/`, `src/i18n/<locale>/systems/`. |
| 5.3 | Each system has a `systems/[slug]/register.ts` at the project root. |
| 5.4 | `server/db/frontend-queries/` exists (even if only `.gitkeep`). |
| 5.5 | `server/core-register.ts` exists and registers all core caches, handlers, jobs. |
| 5.6 | `server/module-registry.ts` exports all registration functions listed in §12.9. |
| 5.7 | No misplaced files (e.g., a core component inside `src/components/systems/`). |

---

### Phase 6 — Database Conventions (§7)

| Step | Check |
|------|-------|
| 6.1 | **Single-call rule (§7.2).** Every query function in `server/db/queries/` uses a single `db.query()` call. No sequential `await db.query()` or `Promise.all` of multiple `db.query()`. Values passed via `LET`. Final `SELECT … FETCH` is part of the same batch. |
| 6.2 | **Mandatory helpers (§7.3).** Every create/update path calls `standardizeField` → `validateField`/`validateFields` → `checkDuplicates` → `withEntityLimit` (where applicable). No ad-hoc validation or duplicate checks in route handlers. |
| 6.3 | **Cursor-based pagination (§7.1).** No `SKIP` anywhere. All paginated queries use cursor-based pagination. Frontend supplies `limit`, capped at 200 server-side. |
| 6.4 | **FULLTEXT search.** Textual lookup fields use FULLTEXT indexes with `general_analyzer_fts`. |
| 6.5 | **Connection singletons.** `server/db/connection.ts` uses HTTP (not WebSocket) with singleton `getDb()`. `client/db/connection.ts` uses WebSocket for LIVE SELECT only. |
| 6.6 | **Migration runner.** Scans root + `systems/<slug>/` + `frameworks/*/server/db/migrations/`, sorts by numeric prefix globally, records relative paths. |
| 6.7 | **Seed runner.** Seeds are idempotent (check existence before inserting). |

**Fix approach:** This is critical. Violations of the single-call rule cause
transaction conflicts in production. Fix each query function individually.

---

### Phase 7 — Tenant & Context (§9)

| Step | Check |
|------|-------|
| 7.1 | **Unauthenticated requests get synthetic Tenant.** Never `null`. `systemId="0"`, `companyId="0"`, empty roles/permissions. |
| 7.2 | **Backend never reads** `companyId`/`systemId`/`roles`/`permissions` **from query strings, cookies, or request bodies.** All from Tenant. |
| 7.3 | **Queries, handlers, jobs accept `tenant: Tenant`.** Not loose IDs. |
| 7.4 | **`getSystemTenant()`** is the only place a system Tenant is constructed. |
| 7.5 | **Token exchange is the sole mechanism to change Tenant (§19.11).** No other code path modifies the active tenant. |
| 7.6 | **`assertScope()`** exists and is used where needed. |

---

### Phase 8 — Configuration Singletons (§10)

| Step | Check |
|------|-------|
| 8.1 | **Core (§10.1).** Server-only guard (`typeof window` check). All data backed by cache registry. `DB_*` statics from `database.json`. `getSetting(key, systemSlug?)` with fallback logic. Pre-built `Map` indexes for O(1) lookups (no array iteration). |
| 8.2 | **FrontCore (§10.2).** Server-only guard. Reads from `front_setting` (never `setting`). `reload()` delegates to `updateCache("core", "front-data")`. |
| 8.3 | **Core settings (§10.1.4).** Every key in the table is seeded by `002_default_settings.ts`. |
| 8.4 | **FrontCore settings (§10.2.6).** Every key is seeded by `003_default_front_settings.ts`. |
| 8.5 | **Missing-settings log.** `getSetting()` logs missing keys with timestamps. `/api/core/settings/missing` exposes the log. |
| 8.6 | **Subscription cache.** Per-tenant, lazily loaded, backed by cache registry under `"core"::"sub:<companyId>:<systemId>"`. `evictAllSubscriptions()` exists. |
| 8.7 | **Derived caches cleared when source changes.** `Core.reload()` clears `"jwt-secret"`. |

---

### Phase 9 — Middleware Pipeline (§11)

| Step | Check |
|------|-------|
| 9.1 | **`compose()`** exists and chains middleware correctly. |
| 9.2 | **Every API route uses `compose()`.** No route handler bypasses the pipeline. |
| 9.3 | **Execution order:** `withRateLimit` → `withAuth` → `withPlanAccess` → `withEntityLimit`. |
| 9.4 | **Auth routes (`/api/auth/*`) only use `withRateLimit`.** They receive synthetic anonymous Tenant. |
| 9.5 | **`withAuth` options.** `roles`, `permissions`, `requireAuthenticated` work correctly. Superusers bypass all role/permission checks. |
| 9.6 | **Route handlers never parse `Authorization` header themselves.** |

---

### Phase 10 — Cross-Cutting Utilities (§12)

| Step | Check |
|------|-------|
| 10.1 | **Rate limiter (§12.1).** Sliding window. Global limit from plan + voucher. Distributed across active actors with `floor(globalLimit / activeActorCount)`, minimum 1. |
| 10.2 | **Usage tracker (§12.2).** Signature matches spec. Upserts `usage_record`. |
| 10.3 | **Credit tracker (§12.3).** `trackCreditExpense` and `consumeCredits` match signatures. `consumeCredits` is single batched query. Full algorithm: plan credits first → purchased → auto-recharge → insufficient alert. |
| 10.4 | **Entity deduplicator (§12.4).** `checkDuplicates` called before every CREATE on entities with UNIQUE indexes. Null/undefined fields silently skipped. |
| 10.5 | **Field standardizer (§12.5).** Every field type from the table is handled. Called before validation and storage. |
| 10.6 | **Field validator (§12.6).** Returns i18n key arrays. Route handlers return `{ code: "VALIDATION", errors }` on non-empty. |
| 10.7 | **CORS (§12.7).** Enforces `frontendDomains` for `frontendUse=true` tokens. Rejects missing Origin, non-matching Origin, browser Origin on non-frontend tokens. |
| 10.8 | **Token revocation (§12.8).** `revokeJti` / `isJtiRevoked`. TTL table for user JWTs. `api_token.revokedAt` for never-expiring tokens. `withAuth` checks on every request. |
| 10.9 | **Cache registry (§12.11).** No ad-hoc `Map` + `loaded` + `loadPromise` patterns. Every cache registered via `registerCache`. Slug + name scoping. Single-flight loading. |
| 10.10 | **Guard functions (§12.10).** `resolveEntityLimit`, `checkPlanAccess`, `resolveRateLimitConfig` — all read from Core cache, never query DB directly for plan/voucher/subscription data. |
| 10.11 | **Module registry (§12.9).** All registration functions present: `registerHandlerFunction`, `registerJob`, `registerSystemI18n`, `registerTemplate`, `registerCache`/`getCache`/`updateCache`/`clearCache`, lifecycle hooks, component/homepage registries. |
| 10.12 | **Boot sequence (§12.9).** `server/jobs/index.ts`: `registerCore()` → `registerAllSystems()` → `registerAllFrameworks()` → `startEventQueue()` → `getAllJobs()`. |

---

### Phase 11 — File Storage (§13)

| Step | Check |
|------|-------|
| 11.1 | **Path pattern (§13.1).** `{companyId}/{systemSlug}/{userId}/{...category}/{uuid}/{fileName}`. |
| 11.2 | **Upload route (§13.2).** Single dual-mode endpoint. Authenticated mode: `withAuth`, validate, enforce size limit, save with metadata. Unauthenticated mode: per-IP rate limit, path whitelist, extension whitelist, size limit, `control` callback. |
| 11.3 | **Download route (§13.3).** Reads via `fs.read()`, streams with proper headers. |
| 11.4 | **Public API routes (§13.4).** No auth required, read-only. `GET /api/public/system`, `GET /api/public/front-core`, `POST /api/leads/public`. |
| 11.5 | **No separate file_metadata table.** All metadata managed by `@hviana/surreal-fs`. |

---

### Phase 12 — Event Queue (§14)

| Step | Check |
|------|-------|
| 12.1 | **Two-table architecture.** `queue_event` + `delivery`. Workers pull from `delivery`. |
| 12.2 | **Publisher (§14.2).** Inserts event → looks up handlers → inserts deliveries. |
| 12.3 | **Registry (§14.3).** Handlers registered via `registerEventHandler` at boot, not hardcoded. |
| 12.4 | **Worker (§14.4).** Implements: claim with lease, parallel execution up to `maxConcurrency`, retry with exponential backoff, dead-letter after `maxAttempts`, lease recovery. |
| 12.5 | **Idempotency (§14.5).** Every handler checks if the action was already performed. Uses `delivery.id` or `event.id` as idempotency key. |

---

### Phase 13 — Communication Templates (§15)

| Step | Check |
|------|-------|
| 13.1 | **Every template uses `t()`.** No hardcoded English. All strings from `src/i18n/{locale}/templates.json`. |
| 13.2 | **Shared layout (§15.2).** `_layout.ts` produces mobile-first, table-based email HTML. Inline CSS only. Brand colors hardcoded. CTA as `<table>` with gradient. Preheader text. Dark mode support. |
| 13.3 | **Body structure (§15.3).** Mandatory order: emoji hero → greeting → summary → fact table → CTA → footer with `app.name` and support email. |
| 13.4 | **Template catalog (§15.4).** All 10 templates exist: verification, password-reset, payment-success, payment-failure, auto-recharge, insufficient-credit, tenant-invite, recovery-verify, recovery-channel-reset, lead-update-verification. |
| 13.5 | **Channel handlers (§15.5).** `send_email` and `send_sms` are the only handlers that talk to external services. They resolve locale (§5.4), senders, template function from registry, then render and send. |
| 13.6 | **Aesthetic quality.** Email templates are visually polished, mobile-friendly, with proper spacing, typography, and brand consistency. |

**Fix approach:** Improve visual quality of email templates — spacing, color
balance, CTA button design, responsive breakpoints. Ensure dark mode renders
correctly.

---

### Phase 14 — Frontend Architecture (§17)

| Step | Check |
|------|-------|
| 14.1 | **`useAuth` (§17.3).** Holds opaque token. Exposes `login()`, `logout()`, `refresh()`, `exchangeTenant()`. Decodes Tenant once. No independent `companyId`/`systemId`/`roles` state. |
| 14.2 | **`useLiveQuery`.** Wraps `LIVE SELECT`, manages WebSocket. |
| 14.3 | **`useSystemContext` (§17.3).** Thin wrapper over `useAuth`. Switchers call `exchangeTenant()`, never mutate local state. |
| 14.4 | **`useLocale`.** Exposes `locale`, `setLocale()`, `t()`, `supportedLocales`. |
| 14.5 | **`usePublicSystem`.** Fetches public system info without auth. |
| 14.6 | **`useFrontCore`.** Lazily loads, synchronous `get(key)`, reloads on live-query signal. |
| 14.7 | **Single-token rule (§17.4).** Frontend stores only the opaque token string. No React context stores `companyId`, `systemId`, `roles`, or `permissions` independently. Every `fetch` wrapper uses `useAuth()` token. |
| 14.8 | **Payment contracts (§17.2).** Client-side `IClientPaymentProvider` with `tokenize()`. Server-side `IPaymentProvider` with `charge()`. |

---

### Phase 15 — UI Components (§18)

| Step | Check |
|------|-------|
| 15.1 | **All primitives (§18.1) exist:** Spinner, Modal, LocaleSelector, SearchField, CreateButton, EditButton, DeleteButton, FormModal, GenericFormButton, ErrorDisplay, FilterDropdown, DateRangeFilter, FilterBadge, DownloadData, BotProtection, SystemBranding, Sidebar, SidebarMenuItem, SidebarSearch, ProfileMenu, TagSearch. |
| 15.2 | **Spinner props.** `size?: "sm" \| "md" \| "lg"`. |
| 15.3 | **GenericList (§18.2).** Props match spec exactly: `entityName`, `searchEnabled`, `createEnabled`, `filters`, `fetchFn`, `renderItem`, `fieldMap`, `controlButtons`, `actionComponents`, `debounceMs`, `formSubforms`, routes. Cursor-based pagination (Load More / Prev-Next). |
| 15.4 | **GenericListItem.** Renders field name + formatted value per `FieldType`. |
| 15.5 | **FormModal.** Props match spec. Renders subforms vertically. Uses `useImperativeHandle` for `getData()` + `isValid()`. |
| 15.6 | **Field-selection policy (§18.3).** No plain `<input type="text">` for structured/relational data. Correct component for each data type. No comma-separated textareas for arrays. |
| 15.7 | **FileUploadField (§18.4).** Props match spec. Sends FormData to `/api/files/upload`. Shows progress, cancel, delete, preview. |
| 15.8 | **SearchableSelectField (§18.4).** Debounced, dropdown, removable badges. |
| 15.9 | **DynamicKeyValueField (§18.4).** Used by settings editors only. |
| 15.10 | **MultiBadgeField (§18.4).** Two modes: `"custom"` (free text) and `"search"` (backend values only). Correct usage across all forms. |
| 15.11 | **TagSearch (§18.4).** Wraps `MultiBadgeField mode:"search"`. Converts badge format to flat ID array. |
| 15.12 | **All subforms (§18.5) exist and expose** `getData()` + `isValid()` via `useImperativeHandle`. |
| 15.13 | **Sidebar (§18.6).** Starts hidden, hamburger toggle, closes on outside click, recursive `SidebarMenuItem`, search filter. |
| 15.14 | **ProfileMenu (§18.7).** Company selector, system selector, profile link, logout. Both selectors use `SearchableSelectField` with `multiple={false}` and `showAllOnEmpty`. Changing company resets system selector. Both call `exchangeTenant()`. |
| 15.15 | **`(app)` layout (§18.8).** Onboarding guard, default context, context persistence via cookies, sidebar branding (never "Core"), menu loading (custom + hardcoded defaults with offset sortOrder), initial-page rule (depth-first first `componentName`). |
| 15.16 | **Public homepages (§18.9).** Router in `app/page.tsx`: `?system=` → default → core fallback. Homepage registry in `src/components/systems/registry.ts`. |
| 15.17 | **Plan cards (§18.10).** Rich glassmorphism design per spec. Voucher-adjusted effective price rendering. |
| 15.18 | **Aesthetic quality of all components.** Glassmorphism standard, hover effects, gradient accents, proper spacing, visual consistency. Make improvements where components look unfinished or inconsistent. |

---

### Phase 16 — Authentication (§19)

| Step | Check |
|------|-------|
| 16.1 | **Token architecture (§19.1).** System API Token only. Frontend live queries use SurrealDB credentials from settings. |
| 16.2 | **System branding on public pages (§19.2).** All auth pages read `?system=`. Links between auth pages preserve `?system=`. |
| 16.3 | **Registration flow (§19.3).** Bot protection, LGPD checkbox (`termsAccepted: true`), rate limit, argon2 hash in DB, verification request, email sent, login blocked until verified. |
| 16.4 | **Login flow (§19.4).** Bot protection, rate limit, argon2 compare, verified check, 2FA if enabled, issue token with correct expiry. |
| 16.5 | **Post-login routing (§19.5).** Superuser → `/systems`. No companies → `/onboarding/company`. Companies but no subscriptions → `/onboarding/system`. Complete → `/entry`. |
| 16.6 | **Token exchange (§19.11).** Verify JWT, check `actorType="user"`, verify membership, load roles/permissions, revoke old token, issue new JWT with fresh `jti` and remaining lifetime. Atomic in single batched query. |
| 16.7 | **Superuser bypass (§19.11.1).** Exchange skips membership check. Issues `roles: ["admin"]`, `permissions: ["*"]`. No `company_user`/`user_company_system` rows created. |
| 16.8 | **Token revocation lifecycle (§19.12).** Revocation by `jti`. User JWTs use TTL table. Never-expiring tokens use `api_token.revokedAt`. Deletion → revocation guarantee (batched). |
| 16.9 | **Recovery channels (§19.13).** Add, verify, use for recovery, resend, remove. Max 10 per user. Cooldown enforced. Account recovery page exists. |
| 16.10 | **Password recovery (§19.7).** Cooldown check, verification request, email/SMS, link validation, password update. |

---

### Phase 17 — Core Admin Panel (§20)

| Step | Check |
|------|-------|
| 17.1 | **Layout.** Superuser-only. Sidebar with hardcoded core menus using i18n keys. Header uses `t("core.layout.superuserPanel")`. |
| 17.2 | **i18n keys (§20.1).** Every key group exists with full `en` + `pt-BR` translations: `nav.*`, `layout.*`, `systems.*`, `roles.*`, `plans.*`, `vouchers.*`, `menus.*`, `settings.*`, `frontSettings.*`, `terms.*`, `dataDeletion.*`, `companies.*`. |
| 17.3 | **Form conventions (§20.2).** All entity forms use `forwardRef` + `useImperativeHandle`. Correct field components for each data type. |
| 17.4 | **MenuTreeEditor (§20.3).** System selector, tree display with indentation, inline "+" add, incomplete-config badge "⚠", edit modal, delete, drag-and-drop, no top-level search/create button. |
| 17.5 | **SettingsEditor / FrontSettingsEditor (§20.4).** `DynamicKeyValueField` + missing-keys banner + "Add all missing". System selector dropdown. Badge identifying table. |
| 17.6 | **TermsEditor (§20.5).** Generic terms card at top. System terms list below with status badges. Create modal with system search. |
| 17.7 | **DataDeletion (§20.6).** Company + system selectors. Confirmation modal: red warning, awareness checkbox, password re-entry, enabled only when both conditions met. API verifies password via argon2. |
| 17.8 | **CompaniesPage (§20.7).** GenericList with renderItem. Access button for superuser impersonation. Filters: date range, system, plan, status. Revenue chart with 4 grouped columns. Correct API response shapes. |

---

### Phase 18 — Subsystem Panel (§21)

| Step | Check |
|------|-------|
| 18.1 | **UsersPage (§21.1).** Invite flow (new user vs existing user). Admin invariant (no tenant without admin). Role badges. Search, create, edit, delete. |
| 18.2 | **TokensPage (§21.2).** Create modal with all fields including `neverExpires` XOR `expiresAt`, `frontendUse` + `frontendDomains`. Raw token shown once. Delete revokes. |
| 18.3 | **ConnectedAppsPage (§21.3).** No manual add. OAuth-only creation. Revoke deletes `connected_app` + sets `revokedAt` on `api_token` in batched query. |
| 18.4 | **BillingPage (§21.4).** All 7 sections: current plan, available plans, payment methods, credits (purchase + auto-recharge), voucher, payment error & retry, payment history. Per-section error state (no global setError). |
| 18.5 | **UsagePage (§21.5).** Storage chart + credit-expense chart. DateRangeFilter max 31 days. No API-calls metric. Correct API response shape. |

---

### Phase 19 — Billing & Credits (§22)

| Step | Check |
|------|-------|
| 19.1 | **Subscribe action (§22.1).** Idempotent `company_system` creation. Cancels old subscription if exists. Creates new with `remainingPlanCredits`. Creates `user_company_system` with `roles: ["admin"]` if missing. Free plans omit `paymentMethodId`. |
| 19.2 | **All billing actions** match spec: cancel, add_payment_method, set_default_payment_method, remove_payment_method, purchase_credits, set_auto_recharge, apply_voucher, retry_payment. |
| 19.3 | **Credit deduction system (§22.3).** Full algorithm in `consumeCredits`: plan credits first → purchased → auto-recharge trigger → insufficient alert. Single batched query. One-shot alert mechanism. |
| 19.4 | **Plan-credit lifecycle (§22.4).** On subscribe, on renewal, on cancel, on plan change. |
| 19.5 | **Auto-recharge (§22.5).** Handler steps match spec. Email guarantees (≥2 emails per attempt). Security: max amount cap, idempotency key, synthesized subscription Tenant. |
| 19.6 | **Voucher scope (§22.7).** Single-voucher invariant. Plan-scope rule. Auto-removal cascade on voucher edit (batched query). Plan-change resets voucher. |
| 19.7 | **Payment ledger (§22.8).** Every `process_payment` creates `payment` record. History API with date range and pagination. |
| 19.8 | **Spend limits (§22.2).** Checked before chargeable operations. |

---

### Phase 20 — Public API & OAuth (§23–24)

| Step | Check |
|------|-------|
| 20.1 | **Public system route (§23.1).** Returns name, slug, logoUri, defaultLocale, termsOfService. |
| 20.2 | **Public leads (§23.2).** Bot protection, LGPD checkbox, new vs existing lead logic, cooldown, verification flow. |
| 20.3 | **OAuth server flow (§24).** Authorization URL format, popup flow, authorization page (company selector, permission list, authorize/cancel), token creation with SHA-256 hash stored only, `postMessage` reply. |
| 20.4 | **Login page integration.** `oauth=1` redirects to `/oauth/authorize` after login. |

---

### Phase 21 — Terms of Acceptance / LGPD (§25)

| Step | Check |
|------|-------|
| 21.1 | **Resolution order.** `System.termsOfService` → `terms.generic` → `common.terms.fallback`. |
| 21.2 | **Mandatory checkpoints.** Registration and public leads both require `termsAccepted: true`. Backend validates. |
| 21.3 | **Display.** Scrollable container, acceptance checkbox, "View Terms of Service" link opens `/terms?system=<slug>` in new tab. |
| 21.4 | **Public terms page (§25.5).** System branding, full terms HTML, fallback text, `LocaleSelector`. |

---

### Phase 22 — Subframeworks (§26)

| Step | Check |
|------|-------|
| 22.1 | **Namespace isolation.** Framework files live strictly under `frameworks/<name>/`. No imports from core directories, no mixing. |
| 22.2 | **Registration.** `frameworks/index.ts` imports each framework's `register()`. Called in boot sequence after systems. |
| 22.3 | **AGENTS.md inheritance.** Each framework has its own AGENTS.md that references core. |

---

### Phase 23 — Code Quality & Optimization

This phase runs across all files after compliance is verified.

| Step | Check |
|------|-------|
| 23.1 | **TypeScript strict mode compliance.** No `any` types, no unchecked assertions, proper null handling. |
| 23.2 | **Dead code removal.** Unused imports, unreachable branches, commented-out code. |
| 23.3 | **DRY violations.** Repeated logic that should be extracted into shared utilities. |
| 23.4 | **Modern library features.** Use latest SurrealDB client API, `@panva/jose` patterns, React 19 features (no unnecessary `useEffect` for data fetching, prefer server components where applicable). |
| 23.5 | **Query optimization.** Verify SurrealDB queries use indexes efficiently. Avoid N+1 patterns. |
| 23.6 | **Error handling.** Proper error boundaries in React. Server-side errors use the spec error shape. No swallowed errors. |
| 23.7 | **Code conciseness.** Remove verbose patterns, simplify where logic is equivalent. Prefer readability over cleverness. |

---

### Phase 24 — Frontend Aesthetic & Usability Polish

| Step | Check |
|------|-------|
| 24.1 | **Glassmorphism consistency.** All cards, modals, and panels follow the visual standard uniformly. |
| 24.2 | **Animation polish.** Smooth transitions on hover, modal open/close, sidebar toggle. No jarring jumps. |
| 24.3 | **Responsive breakpoints.** Every page renders correctly from 320px mobile to 4K desktop. No horizontal overflow. |
| 24.4 | **Form UX.** Clear validation feedback, disabled states during submission, focus management, keyboard navigation. |
| 24.5 | **Loading states.** Skeleton screens or spinners for initial page loads. No blank screens. |
| 24.6 | **Empty states.** Every list page has a well-designed empty state with clear messaging and CTAs. |
| 24.7 | **Color contrast.** Text is readable against dark backgrounds. Interactive elements have sufficient contrast. |
| 24.8 | **Email template aesthetics.** All 10 templates are visually polished, professional, and render correctly in major email clients (Gmail, Outlook, Apple Mail). |

---

### Execution Rules

1. **Execute phases in order.** Each builds on the previous.
2. **Within each phase, complete all steps before moving on.**
3. **For each step:** first audit (report findings), then fix (apply changes),
   then verify (confirm the fix works).
4. **If a fix is ambiguous or has trade-offs, present options to the user
   before proceeding.**
5. **After every phase, run the dev server and smoke-test affected flows.**
6. **Create a commit after each phase** with a descriptive message following
   the pattern: `review: phase N — <description>`.
7. **If the dev server fails to start or a page breaks, stop and fix before
   continuing.**
8. **Keep a running log of all changes** made during the review.
