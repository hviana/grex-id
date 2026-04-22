# Agent Checklist

Run through this list before marking any task complete. Each item links to the
authoritative rule in [AGENTS.md](../AGENTS.md). If a rule does not apply, skip
it — but skip deliberately, not by default.

---

## 1. Runtime & Style Invariants

- [ ] No `node:*`, `Deno.*`, `Bun.*`, or native-only APIs — Web APIs only
      (§1.1.1).
- [ ] Every `fetch()` / AJAX origin renders `<Spinner />` (§1.1.3, §18.1).
- [ ] Searchable text fields use `useDebounce` with a configurable delay
      (§1.1.4, §17.3).
- [ ] Mobile-first layout — design for small screens first, scale up (§1.1.2).
- [ ] Styling is Tailwind-only; the only custom CSS lives in `:root` (§4).
- [ ] Inputs/textareas use `placeholder-white/30`; placeholder text comes from
      `t("common.placeholder.*")` (§4).
- [ ] Icons are emojis — no icon library imports (§1.1.6).
- [ ] All UI text, labels, error strings, template bodies use `t()` keys; `en` +
      `pt-BR` both exist (§5, §1.1.7).
- [ ] Backend errors return `{ code: "VALIDATION" | "ERROR", … }` with i18n keys
      only (§1.1.8, §5.7).
- [ ] No new dependencies outside the `§2` allowed list without explicit
      approval.

---

## 2. File Structure & Namespacing

**Three distinct layers — never mix them:**

- **Core** is the platform foundation. Lives at the project root (`app/`,
  `src/`, `server/`). Knows nothing about specific subsystems or frameworks.
- **Subsystems** are separate runtime tenants (one per product / slug). They
  live in `[slug]` subfolders under every relevant root and **consume**
  resources from Core and from frameworks. They do not extend Core.
- **Frameworks** are reusable code bundles under `frameworks/<name>/` that
  **extend** Core behavior. They are consumed by zero or more subsystems. They
  do not belong to any single subsystem.

Core ⇐ Frameworks ⇐ Subsystems. A framework never imports from a subsystem. A
subsystem never imports from another subsystem. A framework never imports from
another framework. Core never imports from either.

- [ ] New UI goes to the correct shared dir
      (`src/components/shared|fields|subforms|core`) (§6, §18).
- [ ] Subsystem-scoped code lives under `[slug]` subfolders of every relevant
      root — components, migrations, queries, frontend-queries, event-queue
      handlers, api, public, i18n per locale (§6).
- [ ] Adding a new subsystem creates `[slug]` subfolders in ALL required roots
      AND a `systems/<slug>/register.ts` wired into `systems/index.ts` (§6,
      §12.9).
- [ ] Subsystems never place files outside their `[slug]` folders and never
      import from another subsystem or from Core internals — only from exported
      Core utilities and from frameworks they explicitly depend on.
- [ ] Framework code is confined to `frameworks/<name>/`; a framework never
      imports from Core internals, from another framework, or from any subsystem
      (§26.1, §26.3).
- [ ] Frameworks keep their own self-contained subtree (own `AGENTS.md`, own
      routes at `/api/<name>/…`, own components, contracts, migrations, queries,
      i18n, seeds). No file is ever shared, symlinked, or aliased across the
      Core ↔ framework ↔ subsystem boundary (§26.1).
- [ ] Empty structural folders contain `.gitkeep` (§6).
- [ ] Server-only files call `assertServerOnly(fileName)` as their first
      post-import statement (§12.14).

---

## 3. Component Reuse — Generic First

Before writing any new UI, verify a shared primitive does not already handle it
(§3.1).

- [ ] Lists → `GenericList` + `GenericListItem` (§18.2) — never a bespoke list.
- [ ] Forms → `FormModal` + subforms exposing `getData()` / `isValid()` (§18.2,
      §18.5).
- [ ] Structured inputs → `MultiBadgeField`, `SearchableSelectField`,
      `DynamicKeyValueField`, `FileUploadField`, `TagSearch` per §18.3 policy.
- [ ] Entity channels (email/phone/…) → `EntityChannelsSubform` (never a raw
      email/phone input for list collection) (§18.5, §19.13).
- [ ] Action buttons → `CreateButton` / `EditButton` / `DeleteButton` /
      `GenericFormButton` (§18.1).
- [ ] XLSX export → `DownloadData` (§18.1.1).
- [ ] Role/permission/entity/resource labels → `TranslatedBadge` (§18.1.2,
      §5.6.1).
- [ ] Plan cards → `PlanCard` with `variant` (§18.10).
- [ ] Usage panel → `UsagePage` (tenant or core mode) (§21.5).
- [ ] Data-tracking → `CookieConsent` mounted once in root layout;
      `useDataTrackingConsent()` gates any capture of
      `front.dataTracking.trackedCharacteristics` (§18.1.3, §25.6).
- [ ] Public pages receive system branding via `?system=<slug>`; links preserve
      the query param (§19.2, §25).
- [ ] Sidebar MUST NEVER display "Core" for `(app)` — show a `Spinner` while
      system is loading (§18.8).
- [ ] Post-login routes to `/entry` (spinner-only landing), then the `(app)`
      layout resolves the first menu item with a non-empty `componentName`
      (§18.8, §19.5).

---

## 4. Internationalization

- [ ] New labels go under the correct domain file (`common`, `auth`, `core`,
      `billing`, `homepage`, `templates`, `validation`, `systems/<slug>`, or
      `frameworks/<name>`) (§5.1, §5.6.1).
- [ ] Role / permission / entity / resource tokens follow the standard key
      structure (§5.6.1) — and are displayed via `TranslatedBadge` (§18.1.2).
- [ ] DB-stored display labels hold i18n keys, not human text (§5.6). Machine
      identifiers (slugs, permission tokens) stay raw.
- [ ] Email/SMS templates call `t()` — no hardcoded copy (§1.1.9).
- [ ] Server-side locale resolution order (§5.4); frontend resolution order
      (§5.3).

---

## 5. Database & Queries

- [ ] New tables are `SCHEMAFULL` (§7.1); passwords via `crypto::argon2::*` only
      (§7.1).
- [ ] Compositional model: reusable structures are separate tables linked via
      `record<>`; parent holds the link, child has **no** back-pointer (§1.1.10,
      §7.1).
- [ ] Pagination is cursor-based, capped at 200 server-side (§7.1).
- [ ] Queries live under `server/db/queries/` — never inlined in route handlers
      (§7.1).
- [ ] **Every query function batches all statements into one `db.query()`** — no
      sequential awaits, no `Promise.all` of `db.query()` (§7.2).
- [ ] CREATE flow uses the mandatory helpers: `standardizeField` →
      `validateField` → `checkDuplicates` → `withEntityLimit` (§7.3,
      §12.4-12.6).
- [ ] FULLTEXT indexes on searchable text fields; indexes on every column used
      in WHERE / ORDER BY (§7.1, §8).
- [ ] Idempotent `CREATE` on unique-keyed rows uses existence-check +
      conditional CREATE, never raw CREATE (see §22.1 `company_system`).
- [ ] Live-query tables declare `PERMISSIONS FOR select WHERE <ownership>`
      (§7.6).
- [ ] One table per migration file, numeric prefix; merged globally across root
      / systems / frameworks (§7.7, §8).
- [ ] Seeds are idempotent — check existence before insert (§7.7).
- [ ] Frontend uses `LIVE SELECT` only; WebSocket credentials come from
      `db.frontend.*` settings (§7.5, §7.6).

---

## 6. Sensitive Data & Encryption

- [ ] No plaintext password / card / raw token / TOTP secret / private key /
      restricted PII in any column, seed, query, log, or email payload (§7.1.1).
- [ ] Encryption-at-rest fields go through `encryptField()` / `decryptField()`
      (`server/utils/crypto.ts`) on every write and every read (§12.15).
- [ ] `verification_request.payload` never carries sensitive data — only i18n
      keys, ids, and non-sensitive context (§15.1 rule 5).
- [ ] Plaintext never leaves request scope (no logging, caching, or column copy)
      (§12.15).

---

## 7. Tenant Context & Auth

- [ ] Backend never reads `companyId` / `systemId` / `roles` / `permissions`
      from query strings, cookies, or bodies — only from `ctx.tenant` /
      `ctx.claims` (§9.2).
- [ ] Queries, jobs, event handlers, utilities accept `tenant: Tenant` — not
      loose ids (§9.2 rule 3).
- [ ] Anonymous requests receive the synthesized anonymous Tenant, never `null`
      (§9.2 rule 1).
- [ ] System jobs use `getSystemTenant()` — the only place that tenant is
      constructed (§9.2 rule 4).
- [ ] Context change goes only through `/api/auth/exchange` — app/connected-app
      tokens are non-exchangeable (§19.11).
- [ ] Frontend stores only the opaque token; reads
      `companyId`/`systemId`/`roles` via `useAuth().tenant` (§17.4).

---

## 8. Middleware Pipeline

Compose order = latency budget. Cheapest middleware first; any DB-hitting
middleware without a cache goes last (§11).

- [ ] Standard order: `withRateLimit` → `withAuth` → `withPlanAccess` →
      `withEntityLimit` (§11).
- [ ] `withAuth` never queries the DB — uses `isActorValid` +
      `ensureActorValidityLoaded` only (§12.8).
- [ ] Routes never parse the `Authorization` header themselves (§11 step 2).
- [ ] Auth routes (`/api/auth/*`) use only `withRateLimit` (§11).
- [ ] Superusers bypass role/permission checks uniformly (§11 step 2).

---

## 9. Actor-Validity Cache

Every durable change that affects validity mutates the cache in the same request
(§12.8):

- [ ] Login → `rememberActor(tenant, user.id)`.
- [ ] Logout → `forgetActor(tenant, claims.actorId)`.
- [ ] Exchange → `forgetActor(old)` + `rememberActor(new)`.
- [ ] Token create / OAuth authorize → `rememberActor(tenant, token.id)`.
- [ ] Token / connected-app revoke → set `revokedAt` AND `forgetActor`.
- [ ] Role change / user removed from tenant → `forgetActor(tenant, userId)`.
- [ ] User hard-delete → iterate memberships, `forgetActor` + evict api_tokens.
- [ ] Data-deletion → `reloadTenant(tenant)` after the batched delete.

---

## 10. Caching

- [ ] Every server-side cache is registered via
      `registerCache(slug, name, loader)` — no ad-hoc `Map` + `loaded` flag
      patterns (§12.11).
- [ ] Slug identifies the namespace; frameworks / systems use their own (§12.11
      rule 2).
- [ ] After mutations, handler calls `updateCache` (or singleton `reload()` that
      delegates) (§12.11 rule 4).
- [ ] Derived caches (e.g. JWT secret) are cleared when their source changes
      (§12.11 rule 5).
- [ ] `withAuth`, `withPlanAccess`, `withEntityLimit`, rate limiter read
      plan/voucher/subscription from Core cache — never direct DB (§11, §12.10).
- [ ] Cache loaders build pre-indexed `Map`s for O(1) lookups — never iterate
      arrays (§10.1).
- [ ] Settings: server-only keys live in `setting` (Core); browser-safe keys
      live in `front_setting` (FrontCore) — never cross-read (§10.2.8).
- [ ] Per-system overrides use `systemSlug` (literal `"core"` = default);
      `systemSlug` MUST NOT be empty (§10.1, §10.2).
- [ ] New Core/FrontCore setting is readable only via `Core.getSetting()` /
      `FrontCore.getSetting()` — no hardcoded fallback constants (§10.1).

---

## 11. Costs, Credits & Usage

If the operation is chargeable:

- [ ] Call `consumeCredits({ resourceKey, amount, companyId, systemId })` before
      side effects (§12.3).
- [ ] `consumeCredits` handles plan-credit → purchased → operation-count cap →
      auto-recharge → one-shot alert atomically (§22.3).
- [ ] Failure branches: `insufficient`, `operationLimit` — operation rejects
      with the correct i18n key (§12.3, §22.3).
- [ ] Call `trackUsage` after successful chargeable ops for resource-keyed usage
      rollups (§12.2).
- [ ] Plan / voucher limits resolved via guard functions (§12.10), not inline
      reads.
- [ ] Actor-level `maxOperationCount[resourceKey]` checked for api_token /
      connected_app actors (§22.3 step 4a).
- [ ] `remainingPlanCredits` / `remainingOperationCount` reset on subscribe +
      renewal; voucher deltas applied on apply (§22.4).

---

## 12. Plan Limits

For any new entity or resource, decide the right cap:

- [ ] Entity creation count → add to plan `entityLimits` + use `withEntityLimit`
      middleware (§11, §8).
- [ ] Operation count cap → add resource key to plan `maxOperationCount` +
      decrement in `consumeCredits` (§22.3).
- [ ] API rate limit → plan `apiRateLimit`, distributed across actors (§12.1).
- [ ] Storage → plan `storageLimitBytes` + `fileCacheLimitBytes` (§13, §12.12).
- [ ] Transfer → `maxConcurrentDownloads/Uploads`,
      `maxDownloadBandwidthMB/UploadMB` enforced in `control` callback (§13.2,
      §13.3, §12.10).
- [ ] Every limit has a matching voucher modifier if tuning per-contract is
      expected (§8, §22).
- [ ] i18n label added under `billing.limits.<key>` (§21.4, §21.5).
- [ ] Spend limits (`monthlySpendLimit`) checked for the actor before any
      chargeable op (§22.2).
- [ ] Free plans (price = 0) skip payment method; paid plans reject subscribe
      without one (§22.1 `subscribe`).

---

## 13. File Storage

- [ ] Path follows
      `[companyId, systemSlug, userId, ...category, fileUuid, fileName]`
      (§13.1).
- [ ] `fileUuid` is frontend-generated — new file → new UUID, replacement → same
      UUID (§13.1, §13.2).
- [ ] Validation, rate limits, size, extension checks happen inside the
      `control` callback, never in the route handler (§13.2).
- [ ] Replacement uploads call `evict()` on the cache (§13.2 step 7).
- [ ] Download streams-first; cache check before SurrealFS; background tee
      insertion is deduplicated (§13.3).
- [ ] MIME type comes from upload metadata or cached entry — no invented MIME
      maps (§13.3 step 5).
- [ ] Category-scoped access goes through `file_access` rules +
      `checkFileAccess` (upload and download) (§13.7).
- [ ] `companyId` / `userId` in the path come from `ctx.tenant` / `ctx.claims`,
      NOT from FormData or URL; anonymous = `"0"` (§9, §13.2).
- [ ] Downloads with `?token=` resolve the token independently and re-run
      `checkFileAccess` against the resolved tenant (§13.7).
- [ ] File metadata is stored by `@hviana/surreal-fs` — never a separate
      `file_metadata` table (§13.5).
- [ ] Data-deletion calls `FileCacheManager.clearTenant()` after scoped deletion
      (§13.6, §20.6.1).

---

## 14. Events & Communications

- [ ] Communications publish `send_communication` only — never `send_email` /
      `send_sms` directly (§15.1 rule 1).
- [ ] `channels` array is ordered; fallback to Core
      `auth.communication.defaultChannels` when empty (§15.1 rule 2-3).
- [ ] Recipients: raw values OR owner ids (`user:…` / `lead:…`) whose `channels`
      array is FETCHed (§15.8).
- [ ] Tenant context lives inside `templateData` (§15.1 rule 4, §15.5).
- [ ] Only the two canonical templates: `human-confirmation` (action requires
      click) or `notification` (informational) (§15.4).
- [ ] Human-confirmation requires a backing `verification_request` via
      `communicationGuard()` (§12.13, §15.4.1).
- [ ] Event handlers are idempotent (delivery id or event id as idempotency key)
      (§14.5).
- [ ] Every new event handler is registered through `registerHandler(name, fn)`
      at boot (§12.9, §14.3).
- [ ] Deliveries use per-handler `WorkerConfig` — crashed workers recover via
      `leaseUntil`; failures backoff and dead-letter at `maxAttempts` (§14.4,
      §14.6).
- [ ] New channels register a handler (`send_<channel>`) +
      `registerChannel(<channel>)`; per-channel templates live at
      `server/utils/communication/templates/<channel>/<path>.ts` (§15.3, §15.8).
- [ ] Channel handlers filter recipient `entity_channel` rows by
      `type = <channel> AND verified = true`; on miss return
      `{ delivered: false, reason: … }` so fallback channels fire (§15.8,
      §15.9).
- [ ] Tenant display fields in `templateData` follow the §15.5 table (omit when
      not applicable).
- [ ] Payment webhooks use `transactionId` as the idempotency key;
      `resolve_async_payment` re-checks status before mutating (§22.9).
- [ ] Recurring-billing + async-payment handlers reload the subscription cache
      via `Core.reloadSubscription` after mutations (§10.1, §22.1).

---

## 15. Authentication & Account Invariants

- [ ] Approval: user/lead has at least one verified `entity_channel` in its
      `channels` array (§19.3).
- [ ] `profile.recovery_channels` is for account recovery only — never used for
      login, dispatch, or approval (§19.7.1).
- [ ] Registration inserts `entity_channel` rows + parent update +
      verification_request in one batched query (§19.4, §7.2).
- [ ] Login resolves user via a **verified** `entity_channel` only (§19.5).
- [ ] Password change uses human-confirmation flow — hash in payload, plaintext
      never stored (§19.14).
- [ ] 2FA is per-user; verified-channel fallback always available (§19.15).
- [ ] OAuth identity lives on `oauth_identity` rows keyed by
      `(provider, providerUserId)` — never a scalar on `user` (§19.8).
- [ ] Admin invariant: every (company, system) has ≥1 admin; role-update and
      user-delete enforce this (§21.1).
- [ ] Single-voucher invariant: applying replaces; plan-scope enforced on
      apply + on voucher edit cascade (§22.7).
- [ ] Terms-acceptance checkpoint on registration + public lead submission
      (§25.2).
- [ ] Terms of Service link opens `/terms?system=<slug>` in a new tab below the
      checkbox (§25.3).
- [ ] Entity-channel conflicts reject on registration when a verified or
      unexpired channel owns the same `(type, value)`; abandoned accounts are
      hard-deleted in the same batched query (§19.4 step 4).
- [ ] Channel delete forbidden when it would drop the owner below
      `requiredTypes`; verified channels replaced via add+verify+delete, never
      mutated in place (§19.13).
- [ ] Invited existing user (matched by any channel value) gets a `tenantInvite`
      notification; no new `user` row (§21.1).

---

## 16. Tokens & OAuth

- [ ] All bearers are JWTs embedding the full Tenant + `actorId` (§19.10) — no
      opaque path, no token hash.
- [ ] `api_token` / `connected_app` tokens carry `exchangeable: false` (§19.11).
- [ ] `frontendUse` tokens enforce `frontendDomains` via `server/utils/cors.ts`
      (§12.7).
- [ ] Revocation sets `revokedAt = time::now()` AND calls `forgetActor` in the
      same request (§19.12).
- [ ] Raw bearer is returned **once** on create; never reconstructable
      server-side (§21.2, §24.2).
- [ ] Connected apps are created only via the OAuth authorize flow — no manual
      add button (§21.3, §24).
- [ ] Token create rejects: `neverExpires` XOR `expiresAt`; `frontendUse`
      requires ≥1 `frontendDomains` (§21.2).
- [ ] OAuth callback linking to an authenticated session enforces same-user
      match — otherwise rejects with `auth.error.oauthAccountLinkedElsewhere`
      (§19.8).
- [ ] Unlink rejects when it would remove the user's last authentication method
      (§19.8).

---

## 17. Subsystems & Frameworks

**Remember the layering.** Subsystems are runtime tenants that _use_ resources
from Core and frameworks. Frameworks are design-time extensions of Core that can
be consumed by many subsystems. They are not interchangeable and their folders
must stay isolated.

- [ ] Framework and subsystem `AGENTS.md` files never contradict or override the
      root `AGENTS.md` — they only inherit from it and expand it with new
      functionality (§26.2).

### Subsystems (one `[slug]` per product)

- [ ] Every subsystem file sits in a `[slug]` subfolder under the Core roots it
      extends — never at the Core root, never inside `frameworks/`, never inside
      another subsystem (§6).
- [ ] Subsystem routes at `/api/systems/<slug>/…`; components under
      `src/components/systems/<slug>/`; i18n under
      `src/i18n/<locale>/systems/<slug>.json`; migrations under
      `server/db/migrations/systems/<slug>/`; queries under
      `server/db/queries/systems/<slug>/` (§6).
- [ ] Subsystem registers via `systems/<slug>/register.ts`, wired into
      `systems/index.ts` (§12.9).
- [ ] Subsystem MAY ship its own `systems/<slug>/AGENTS.md` that inherits the
      root `AGENTS.md` verbatim and documents only subsystem-specific contracts,
      routes, i18n namespace, resource keys, and consumed frameworks — never
      overrides Core rules (§26.2).
- [ ] Subsystem consumes from Core and from declared frameworks only. It never
      reaches into another subsystem's folder, and it never pulls private
      framework internals (§26.3).

### Frameworks (one `<name>` per extension)

- [ ] Every framework file sits under `frameworks/<name>/` — no mixing with Core
      or with any other framework (§26.1).
- [ ] Framework routes at `/api/<name>/…`; components under
      `frameworks/<name>/src/components/<name>/`; i18n under
      `frameworks/<name>/src/i18n/<locale>/<name>.json`; migrations / queries /
      utilities under `frameworks/<name>/server/…` (§26.1).
- [ ] Framework has its own `AGENTS.md` inheriting Core verbatim (§26.2).
- [ ] Framework registers via `frameworks/<name>/register.ts`, wired in
      `frameworks/index.ts` (§26.4, §12.9).
- [ ] New Core / FrontCore settings are added through the framework's own seed —
      additive only (§26.3).
- [ ] Framework exposes capabilities for subsystems to consume (contracts,
      events, registered handlers/templates, components). It does **not** import
      from any subsystem, and it does not depend on another framework directly —
      cross-framework interactions go through Core events or shared Core
      contracts (§26.3).

---

## 18. Hooks & Frontend State

- [ ] Shared state (auth, locale, FrontCore, system context) uses Context +
      Provider; component-scoped hooks use local state (§17.3.1 rule 1).
- [ ] `useEffect` / `useCallback` list every captured value in deps; inline
      objects are stabilized with `useMemo` (§17.3.1 rule 2).
- [ ] Async effects use a `cancelled` guard and clean up on unmount (§17.3.1
      rule 3).
- [ ] No fire-and-forget `fetch` outside `useEffect` / `useCallback` (§17.3.1
      rule 4).
- [ ] Data-fetching callbacks early-return when token is null (§17.3.1 rule 5).
- [ ] Provider files are `.tsx`; pure-logic hooks are `.ts` (§17.3.1 rule 7).

---

## 19. Security

- [ ] CORS enforced for every `frontendUse` token request (§12.7).
- [ ] Bot protection on login, register, forgot-password, public lead submission
      (§19.9, §23.2).
- [ ] Enumeration-safe responses on forgot-password / account-recovery / 2FA
      login-link (§19.7, §19.15.3).
- [ ] Rate limit tighter on `/api/auth/*` (`auth.rateLimit.perMinute`) (§19.9).
- [ ] Verification tokens respect `auth.communication.expiry.minutes` +
      `communicationGuard()` cooldown + rate limit (§12.13).
- [ ] `verification_request` rows capture tenant context (`companyId`,
      `systemId`, `systemSlug`, `actorId`, `actorType`) alongside `payload` (§8,
      §12.13).
- [ ] Permission checks use wildcard `"*"` semantics; superusers bypass (§11).
- [ ] Data-deletion re-verifies superuser password via argon2 (§20.6).
- [ ] Public routes (`/api/public/*`) expose only non-sensitive data; the
      webhook endpoint validates provider signatures in the adapter layer
      (§13.4, §22.9).
- [ ] Public system lookup accepts `?slug=` OR `?default=true`; never leaks
      private config (§13.4).
- [ ] `checkDuplicates` is called before CREATE on every unique-index-backed
      field (§12.4, §7.3).

---

## 20. Tests & Verification

- [ ] Use the project skills — see `skills/test-db-queries/SKILL.md`,
      `skills/test-routes/SKILL.md`, `skills/test-frontend/SKILL.md`,
      `skills/check-library-updates/SKILL.md`.
- [ ] For UI or frontend changes, exercise the feature in a real browser; state
      explicitly if you couldn't.
- [ ] Type-check and run tests where available; don't claim success on un-run
      code.

---

## 21. Semantic Review (think before shipping)

Before calling a feature done, answer these:

- [ ] **Does this operation consume resources?** If yes, which `resourceKey`?
      Added to plan `maxOperationCount` + priced via `consumeCredits` (§22.3).
- [ ] **Is this read hot?** If yes, cached via `registerCache` with an explicit
      invalidation path (§10, §12.11). If no, justify the DB hit.
- [ ] **Does this entity need a creation cap?** If yes, added to plan
      `entityLimits` + `withEntityLimit` middleware (§11, §12.10).
- [ ] **Can the new entity be multi-tenant?** Every scoped query filters by
      `tenant.companyId` + `tenant.systemId`; indexes cover those columns (§9,
      §8).
- [ ] **Does it mutate actor validity?** Cache updated in the same request (§9
      of this file, §12.8).
- [ ] **Does it accept user-generated text?** Standardize → validate → dedupe
      BEFORE write (§7.3).
- [ ] **Does it schedule something?** Published through the event queue with an
      idempotent handler + retry budget (§14).
- [ ] **Does it touch a composable?** Parent holds the link; child is
      back-pointer-free; both mutations happen in the same batched query
      (§1.1.10).
- [ ] **Does it charge money?** `payment` row created before charge attempt;
      success/fail updates include `transactionId` / `failureReason`; async
      flows set `continuityData` + `expiresAt` (§22.8, §22.9).
- [ ] **Does it deliver messages?** Uses `send_communication` + one of the two
      templates; no bespoke per-action template (§15).
- [ ] **Does it need human confirmation?** Routes through
      `communicationGuard()` + `verification_request` — never mutates state
      before the link is clicked (§12.13, §15.4.1).
- [ ] **Is the change reversible by the user?** Destructive admin ops re-verify
      password or use explicit confirmations (§20.6).
- [ ] **Can a superuser perform this cross-tenant?** If yes, uses the exchange
      bypass (§19.11.1), not ad-hoc impersonation.
- [ ] **Does a write invalidate a cache?** Every mutation path lists its
      `updateCache` / `reload()` / `clearCache` call (§10, §12.11).
- [ ] **Does it rely on serverless per-instance state?** Acknowledge the caveat
      — in-memory rate limiters, actor-validity, and file caches are
      per-instance; tight invalidation across instances needs a broadcast
      channel (§12.8, §12.1, §28).
- [ ] **Does it need its tenant context after the request?** Publish via event
      queue or persist it into `verification_request` — never rely on closure
      state (§12.13, §14).
- [ ] **Does it expose a list endpoint?** Provides cursor pagination, optional
      search (debounced), and `FilterDropdown`-compatible filter config (§18.2).
- [ ] **Does the chart / report need a date range?** `DateRangeFilter` with an
      explicit `maxRangeDays` cap (§20.7, §21.5).
- [ ] **Does the feature add billable items to the invoice?** Surfaces a row in
      the payment history with `kind` + `invoiceUrl` (or fallback i18n key)
      (§21.4, §22.8).
- [ ] **Does it create a background job?** Wired via
      `registerJob(name, startFn)` in `core-register.ts` / a system's /
      framework's `register()`; uses the system Tenant (§12.9, §16).

---

## 22. Final Pass

- [ ] No dead comments, no `// removed`, no backwards-compat shims for code you
      just changed.
- [ ] No new abstractions beyond what the task requires.
- [ ] Documentation (AGENTS.md or framework or subsystem AGENTS.md) updated when
      behavior or contracts changed.
- [ ] New i18n keys exist in both `en` and `pt-BR`.
- [ ] Any new DB table / field has a corresponding `src/contracts/` type used by
      route and frontend.
