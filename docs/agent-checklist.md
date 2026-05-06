# Agent Checklist

Run through this list before marking any task complete. Each item references the
authoritative rule in [AGENTS.md](../AGENTS.md). Skip non-applicable items
deliberately, not by default.

---

## 1. Runtime & Style

- [ ] No `node:*`, `Deno.*`, `Bun.*` — Web APIs only (§2.1).
- [ ] Server files call `import "server-only";` (§2.1).
- [ ] Tailwind-only styling; custom CSS only in `:root` vars (§2.2).
- [ ] Emojis for icons; no icon libraries (§2.2).
- [ ] Mobile-first; Spinner on every async action; debounced search (§2.2).
- [ ] Placeholders use `placeholder-white/30` and `t()` keys (§2.2).
- [ ] All UI text, errors, template bodies use `t()` — `en` + `pt-BR` exist
      (§2.3).
- [ ] Backend errors: `{ code, errors/message }` with i18n keys only (§2.3).
- [ ] No dependencies outside §2.1 allowed list without approval.

---

## 2. Namespacing (Core / Systems / Frameworks)

Core ⇐ Frameworks ⇐ Systems. Core never imports from either. Frameworks never
import from each other or from systems. Systems never import from each other. No
file crosses a boundary (§2.7).

- [ ] New UI goes to the correct shared dir
      (`src/components/shared|fields|subforms|core`) or system/framework
      `src/components/` subtree (§2.7, §10.3, §10.1).
- [ ] System code under `systems/<slug>/` (self-contained bundle with `src/`,
      `server/`, `public/`); framework code under `frameworks/<name>/` (same
      internal shape) (§2.7).
- [ ] New system → `systems/<slug>/register.ts` wired into `systems/index.ts`
      AND `systems/<slug>/src/frontend.ts` wired into `systems/frontend.ts`;
      same for frameworks via `frameworks/index.ts` + `frameworks/frontend.ts`
      (§4.6).
- [ ] System/framework `AGENTS.md` inherits root, never overrides (§2.7).
- [ ] Empty structural folders contain `.gitkeep` (§2.7).

---

## 3. Generic-First UI (§2.6, §10.3, §10.4)

- [ ] Lists → `GenericList`. Forms → `FormModal` + subforms. Action buttons →
      shared primitives.
- [ ] Structured inputs → `MultiBadgeField`, `SearchableSelectField`,
      `DynamicKeyValueField`, `FileUploadField`, `TagSearch` per §10.4 policy.
- [ ] Entity channels → `EntityChannelsSubform` (never raw email/phone inputs
      for lists).
- [ ] Role labels → `TranslatedBadge` (§2.3.1). Plan cards → shared `PlanCard`
      (§9.6).
- [ ] Sidebar never shows "Core" in `(app)`; shows Spinner while system loads
      (§9.2).
- [ ] Post-login routes to `/entry`, then layout resolves first menu item
      (§9.2).

---

## 4. Internationalization (§2.3)

- [ ] New keys under correct domain file (`common`, `auth`, `core`, `billing`,
      `homepage`, `templates`, `validation` for Core;
      `systems/<slug>/src/i18n/{locale}/<slug>.json` for systems;
      `frameworks/<name>/src/i18n/{locale}/<name>.json` for frameworks).
- [ ] DB-stored display labels hold i18n keys; machine identifiers stay raw
      (§2.3).
- [ ] Role/entity/resource tokens follow §2.3.1 key structure.

---

## 5. Database & Queries (§3, §2.4)

- [ ] Tables `SCHEMAFULL`; passwords via `crypto::argon2::*` inside SurrealDB
      only (§3.1).
- [ ] Compositional model: separate tables linked via `record<>`; parent holds
      link, child has no back-pointer (§2.4, §3.3).
- [ ] Cascade deletion: dissociate → orphan-check → hard-delete cycle; shared
      data dissociated first, hard-deleted only if orphaned across all tenants
      (§2.4.2). Human confirmation required before association/dissociation of
      sensitive data such `user` or `lead` from a tenant. New entities `group`
      and `shared_record` follow the same cascade rules.
- [ ] Cursor-based pagination, capped at 200 (§2.4).
- [ ] Queries in `server/db/queries/` — never inlined in handlers (§2.4).
- [ ] Record-reference field naming. Every field typed `record<T>` ends with
      `Id` (single) or `Ids` (multiple - `set<record<T>>`). **Tenant references
      always use `tenantIds: set<record<tenant>>`** — never a single `tenantId`
      column, and never scattered `companyId`/`systemId`/`userId` columns. Table
      names are singular, in lowercase with words separated by underscores.
      Fields are in camel case. Non-shared entities must declare
      `TYPE set<record<tenant>, 1>` on `tenantIds` (§2.4).
- [ ] **Generic queries first:** check `generics.ts` (§2.4.1) before writing a
      bespoke query. Only write custom SQL when generics cannot express the
      logic (compositional creates, complex subqueries).
- [ ] Single-batched-query rule: one `db.query()` per function — no sequential
      awaits, no `Promise.all` of `db.query()` (§2.4).
- [ ] CREATE flow: `standardizeField` → `validateField(s)` → `checkDuplicates` →
      entity-limit → write (§4.8, §2.4).
- [ ] **Invariable timezone:** externally-sourced date/datetime values converted
      to DB timezone via `standardizeDateToDb` (§2.4.3). DB-native time
      functions (`time::now()`, etc.) are NOT converted. Frontend-submitted
      dates are pre-converted by `DateSubForm` — do not double-convert.
- [ ] `DateSubForm` converts user input to DB timezone; `DateView` converts DB
      dates to user timezone; both accept `mode: "date" | "datetime"` (§2.4.3,
      §10.3).
- [ ] FULLTEXT on searchable text; indexes on WHERE/ORDER BY columns (§3.1).
- [ ] Idempotent CREATE on unique keys: existence-check, never raw CREATE
      (§3.4). Tenant rows unique on `(actorId, companyId, systemId)`.
- [ ] Live-query tables declare `PERMISSIONS FOR select` (§3.1).
- [ ] Migrations globally numbered, one table per file; seeds idempotent (§3.5).

---

## 6. Sensitive Data & Encryption (§2.4, §4.7)

- [ ] No plaintext passwords/cards/tokens/secrets/PII in any column, log, or
      email (§2.4).
- [ ] Encryption-at-rest: `encryptField`/`decryptField` on every read/write
      (§4.7).
- [ ] `verification_request.payload` carries only i18n keys, ids, non-sensitive
      context (§5.2).

---

## 7. Tenant & Auth (§2.5, §2.10, §4.1, §8)

- [ ] **Token–Tenant boundary:** frontend uses tokens only; backend uses tenant
      contracts. No loose `companyId`/`systemId`/`roles` in forms, hooks, or
      fetch wrappers (§2.10).
- [ ] Backend reads tenant from `ctx.tenantContext.tenant` only — never query
      strings, cookies, bodies (§2.5). Tenant includes `tenant.id` (the record
      ID used as universal scope key). Auth claims (roles, actorType,
      frontendDomains, systemSlug) are resolved from `ctx.tenantContext` (§4.1).
- [ ] All functions accept `tenant: Tenant`, not loose ids (§2.5).
- [ ] Scoped tables use `tenantIds: set<record<tenant>>` instead of separate
      `companyId`/`systemId` fields or a single `tenantId` column (§3.4).
      Queries filter with `tenantIds CONTAINS $tenantId`.
- [ ] Context change only via `/api/auth/exchange`; API tokens (both
      `actorType: "token"` and `actorType: "app"`) are non-exchangeable (§8.6).
- [ ] Frontend stores opaque token only; derives identity from
      `useTenantContext().tenant` and claims from `useTenantContext().roles` /
      `actorType` / `exchangeable` (§10.2).
- [ ] Every tenant corresponds to a real `tenant` table row. Anonymous
      operations use the seeded anonymous API token carrying the `"anonymous"`
      role (§2.5, §3.5).

---

## 8. Middleware & Caching (§4.3, §4.4)

- [ ] Single unified middleware `withAuthAndLimit` (§4.3). Checks execute
      cheapest-first inside one function: rate limit → JWT verify → resolve
      TenantContext → actor validity → CORS → role (superuser and anonymous
      bypass) → plan access → entity limit.
- [ ] `withAuthAndLimit` resolves auth claims (roles, actorType,
      frontendDomains, systemSlug) from unified cache via `get()` at request
      time (§4.2). Auth routes use `withAuthAndLimit({ rateLimit })` only.
- [ ] All cached data accessed via `get(tenant, key, merge?)` — no ad-hoc Maps,
      no separate singletons (§4.4).
- [ ] Mutations call `updateTenantCache(tenant, key)` or
      `revalidateTenantCache(tenant, key, mode)` in same request (§2.8).
- [ ] Derived data cascades via dependency-key mechanism; core data builds `Map`
      indexes for O(1) (§4.4).
- [ ] Settings: `setting.*` (server) vs `front-setting.*` (browser) — never
      cross-read. Both accessed via `get()` with the appropriate key prefix
      (§4.5).
- [ ] Limits use `get(tenant, "limits", limitsMerger)` — raw data accumulated
      across levels, resolved once with `resolveLimits` (§4.4).
- [ ] Timezone offset cached via `get(undefined, "timezone")` — deployment
      constant, never expires (§2.4.3).

---

## 9. Actor-Validity Cache (§4.2)

Simple in-memory `Map<string, Set<string>>` keyed by tenant record ID (§4.2).
Every durable change mutates the cache in the same request. All functions accept
a `Tenant` object:

- [ ] Login → `rememberActor(tenant)`. Logout → `forgetActor(tenant)`.
- [ ] Exchange → `forgetActor(oldTenant)` + `rememberActor(newTenant)`.
- [ ] API token create (manual or OAuth authorize) → `rememberActor(tenant)`.
      Revoke → set `revokedAt` + `forgetActor(tenant)`.
- [ ] Role/membership change (via `resource_limit.roleIds`) →
      `forgetActor(tenant)`. Data-deletion → `reloadTenant(tenant)`.

---

## 10. Events & Communication (§5)

- [ ] Use `dispatchCommunication(…)` — never `publish("send_email"/"send_sms")`
      directly (§5.2).
- [ ] Only two template families: `human-confirmation` or `notification` (§5.3).
- [ ] Human-confirmation backed by `verification_request` via
      `communicationGuard` (§4.12). Payload carries `changes: DBChangeRequest[]`
      — the mutations to apply on approval via `/api/approvals`.
- [ ] Handlers idempotent (delivery/event id as key); registered via
      `registerHandler` (§5.1, §4.6).
- [ ] Tenant context in `templateData`; no sensitive data (§5.2, §5.3).
- [ ] Channel handlers filter
      `entity_channel.type = <channel> AND verified=true` (§5.2).

---

## 11. Billing, Credits, Limits (§7)

- [ ] `consumeCredits` before side effects — handles
      plan→purchased→op-cap→auto-recharge→alert atomically via `tenant.id`
      (§7.3).
- [ ] Entity limits via `withAuthAndLimit({ entities: [...] })` (string array of
      table names); op-count caps via `maxOperationCountByResourceKey`; rate
      limits via `rateLimit` option (§4.9).
- [ ] `trackUsage` after chargeable ops; `trackCreditExpense` upserts daily
      container (§4.10).
- [ ] Voucher: single per subscription; modifiers signed; auto-removal on edit
      (§7.7).
- [ ] Free plans skip payment method; paid plans require one (§7.8).
- [ ] New limit → i18n label under `billing.limits.<key>` + matching voucher
      modifier (§9.6).

---

## 12. File Storage (§6)

- [ ] Path: `[companyId, systemSlug, userId, ...category, fileUuid, fileName]`
      (§6.1).
- [ ] `fileUuid` frontend-generated; validation/limits in `control` callback
      (§6.2).
- [ ] Replacement → `evict()` cache; download streams-first, background tee
      (§6.2, §6.3).
- [ ] Access via `checkFileAccess` (upload + download); `companyId`/`userId`
      resolved from tenant record (§6.4).
- [ ] No separate `file_metadata` table — metadata in surreal-fs (§6.1).

---

## 13. Security (§8.12, §4.13, §4.12)

- [ ] CORS for non-user tokens (via `frontendDomains` on `resource_limit`); bot
      protection on auth/lead forms (§4.13, §8.12).
- [ ] Enumeration-safe responses on forgot-password/recovery/2FA-fallback (§8.7,
      §8.8).
- [ ] `checkDuplicates` before CREATE on every unique-indexed field (§4.8).
- [ ] Public routes expose only non-sensitive data; webhook validates signatures
      (§9.3, §7.6).

---

## 14. Hooks & Frontend State (§10.1)

- [ ] Single `TenantProvider` — unified auth, locale, and front-core context
      (§10.1). Prefer `useTenantContext()` for access.
- [ ] Shared state → Context + Provider. Component state → local hooks.
- [ ] Exhaustive deps on `useEffect`/`useCallback`; inline objects stabilized
      with `useMemo`.
- [ ] Async effects use `cancelled` guard; no fire-and-forget fetches outside
      `useEffect`/`useCallback`.
- [ ] Authenticated callbacks early-return when token null.
- [ ] `useBearerToken()` for the active bearer (system or anonymous) in fetch
      wrappers — never duplicate token selection logic.

---

## 15. Tests & Verification

- [ ] Use project skills — `skills/isolation-guard/SKILL.md` (PRIORITY 1),
      `skills/test-*`, `skills/review-code/SKILL.md`.
- [ ] UI changes exercised in browser; type-check and tests run.

---

## 16. Semantic Review

Before calling done, answer:

- [ ] **Chargeable?** `resourceKey` + `consumeCredits` + plan
      `maxOperationCount` (§7.3).
- [ ] **Hot read?** Cached via `get(tenant, key)` with invalidation path via
      `updateTenantCache`/`revalidateTenantCache` (§4.4).
- [ ] **Entity cap?** Added to plan's `resource_limit.entityLimits` (keyed by
      table name) + `withAuthAndLimit({ entities: [...] })` (§4.9).
- [ ] **Multi-tenant?** Scoped by `tenantIds` array containing `tenant.id` with
      covering index (§3.1, §3.4).
- [ ] **Mutates actor validity?** Cache updated same request (§4.2).
- [ ] **User-generated text?** Standardize → validate → dedupe before write
      (§4.8).
- [ ] **Schedules something?** Event queue with idempotent handler + retry
      (§5.1).
- [ ] **Touches composable?** Parent holds link; no back-pointer; batched
      mutations (§3.3). Deletion follows cascade: dissociate → orphan-check →
      hard-delete (§2.4.2).
- [ ] **Shared across tenants?** Dissociate first; hard-delete only if orphaned
      across all tenants (§2.4.2). Use `shared_record` (for restricted entities)
      or direct tenant association (for shareable entities) per §9.10.
- [ ] **Charges money?** `payment` row before charge; async flows set
      `continuityData`+`expiresAt` (§7.5, §7.6).
- [ ] **Delivers messages?** `dispatchCommunication(…)` + canonical template; no
      bespoke template (§5.2, §5.3).
- [ ] **Needs human confirmation?** `communicationGuard` +
      `verification_request` with `DBChangeRequest[]` payload — no state
      mutation before `/api/approvals` applies the changes (§4.12, §9.10).
- [ ] **Write invalidates cache?** Mutation path lists its
      `updateTenantCache`/`revalidateTenantCache` call (§2.8).
- [ ] **Relies on per-instance state?** Acknowledge in-memory rate limit /
      actor-validity / file-cache caveat — these are not in the unified cache
      (§4.2, §4.4).

---

## 17. Final Pass

- [ ] No dead comments, `// removed`, or backwards-compat shims for changed
      code.
- [ ] No new abstractions beyond task requirements.
- [ ] AGENTS.md (root or subsystem/framework) updated when contracts changed.
- [ ] New i18n keys in both `en` and `pt-BR`.
- [ ] New DB table/field has `src/contracts/` type used by route and frontend.
