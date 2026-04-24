# Agent Checklist

Run through this list before marking any task complete. Each item references the
authoritative rule in [AGENTS.md](../AGENTS.md). Skip non-applicable items
deliberately, not by default.

---

## 1. Runtime & Style

- [ ] No `node:*`, `Deno.*`, `Bun.*` — Web APIs only (§2.1).
- [ ] Server files call `assertServerOnly` first after imports (§2.1).
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
      (`src/components/shared|fields|subforms|core`) or system/framework subtree
      (§2.7, §10.3, §10.1).
- [ ] System code under `[slug]` subfolders of every root; framework code under
      `frameworks/<name>/` (§2.7).
- [ ] New system → `systems/<slug>/register.ts` wired into `systems/index.ts`;
      same for frameworks (§4.6).
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
- [ ] Role/permission labels → `TranslatedBadge` (§2.3.1). Plan cards → shared
      `PlanCard` (§9.6).
- [ ] Sidebar never shows "Core" in `(app)`; shows Spinner while system loads
      (§9.2).
- [ ] Post-login routes to `/entry`, then layout resolves first menu item
      (§9.2).

---

## 4. Internationalization (§2.3)

- [ ] New keys under correct domain file (`common`, `auth`, `core`, `billing`,
      `homepage`, `templates`, `validation`, `systems/<slug>`,
      `frameworks/<name>`).
- [ ] DB-stored display labels hold i18n keys; machine identifiers stay raw
      (§2.3).
- [ ] Role/permission/entity/resource tokens follow §2.3.1 key structure.

---

## 5. Database & Queries (§3, §2.4)

- [ ] Tables `SCHEMAFULL`; passwords via `crypto::argon2::*` inside SurrealDB
      only (§3.1).
- [ ] Compositional model: separate tables linked via `record<>`; parent holds
      link, child has no back-pointer (§2.4, §3.3).
- [ ] Cursor-based pagination, capped at 200 (§2.4).
- [ ] Queries in `server/db/queries/` — never inlined in handlers (§2.4).
- [ ] **Generic queries first:** check `generics.ts` (§2.4.1) before writing a
      bespoke query. Only write custom SQL when generics cannot express the
      logic (compositional creates, complex subqueries).
- [ ] Single-batched-query rule: one `db.query()` per function — no sequential
      awaits, no `Promise.all` of `db.query()` (§2.4).
- [ ] CREATE flow: `standardizeField` → `validateField(s)` → `checkDuplicates` →
      entity-limit → write (§4.8, §2.4).
- [ ] FULLTEXT on searchable text; indexes on WHERE/ORDER BY columns (§3.1).
- [ ] Idempotent CREATE on unique keys: existence-check, never raw CREATE
      (§3.4).
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

## 7. Tenant & Auth (§2.5, §4.1, §8)

- [ ] Backend reads tenant from `ctx.tenant`/`ctx.claims` only — never query
      strings, cookies, bodies (§2.5).
- [ ] All functions accept `tenant: Tenant`, not loose ids (§2.5).
- [ ] Context change only via `/api/auth/exchange`; API/connected-app tokens
      non-exchangeable (§8.6).
- [ ] Frontend stores opaque token only; derives context from `useAuth().tenant`
      (§10.2).
- [ ] Anonymous requests get synthesized Tenant, never `null` (§2.5).

---

## 8. Middleware & Caching (§4.3, §4.4)

- [ ] Order: `withRateLimit` → `withAuth` → `withPlanAccess` → `withEntityLimit`
      — cheapest first (§4.3).
- [ ] `withAuth` uses `isActorValid` — no DB query (§4.2). Auth routes use only
      `withRateLimit` (§4.3).
- [ ] All caches via `registerCache(slug, name, loader)` — no ad-hoc Maps
      (§4.4).
- [ ] Mutations call `updateCache`/`reload()` in same request (§2.8).
- [ ] Derived caches cleared when source changes; loaders build `Map` indexes
      for O(1) (§4.4).
- [ ] Settings: `setting` (server) vs `front_setting` (browser) — never
      cross-read (§4.5).
- [ ] New settings read via `Core.getSetting()`/`FrontCore.getSetting()` only
      (§4.5).

---

## 9. Actor-Validity Cache (§4.2)

Every durable change mutates the cache in the same request:

- [ ] Login → `rememberActor`. Logout → `forgetActor`.
- [ ] Exchange → `forgetActor(old)` + `rememberActor(new)`.
- [ ] Token create/OAuth authorize → `rememberActor`. Revoke → `revokedAt` +
      `forgetActor`.
- [ ] Role/membership change → `forgetActor`. Data-deletion → `reloadTenant`.

---

## 10. Events & Communication (§5)

- [ ] Publish `send_communication` only — never `send_email`/`send_sms` directly
      (§5.2).
- [ ] Only two template families: `human-confirmation` or `notification` (§5.3).
- [ ] Human-confirmation backed by `verification_request` via
      `communicationGuard` (§4.12).
- [ ] Handlers idempotent (delivery/event id as key); registered via
      `registerHandler` (§5.1, §4.6).
- [ ] Tenant context in `templateData`; no sensitive data (§5.2, §5.3).
- [ ] Channel handlers filter
      `entity_channel.type = <channel> AND verified=true` (§5.2).

---

## 11. Billing, Credits, Limits (§7)

- [ ] `consumeCredits` before side effects — handles
      plan→purchased→op-cap→auto-recharge→alert atomically (§7.3).
- [ ] Entity limits via `withEntityLimit`; op-count caps via
      `maxOperationCount`; rate limits via plan `apiRateLimit` (§4.9).
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
      from tenant (§6.4).
- [ ] No separate `file_metadata` table — metadata in surreal-fs (§6.1).

---

## 13. Security (§8.12, §4.13, §4.12)

- [ ] CORS for `frontendUse` tokens; bot protection on auth/lead forms (§4.13,
      §8.12).
- [ ] Enumeration-safe responses on forgot-password/recovery/2FA-fallback (§8.7,
      §8.8).
- [ ] `checkDuplicates` before CREATE on every unique-indexed field (§4.8).
- [ ] Public routes expose only non-sensitive data; webhook validates signatures
      (§9.3, §7.6).

---

## 14. Hooks & Frontend State (§10.1)

- [ ] Shared state → Context + Provider. Component state → local hooks.
- [ ] Exhaustive deps on `useEffect`/`useCallback`; inline objects stabilized
      with `useMemo`.
- [ ] Async effects use `cancelled` guard; no fire-and-forget fetches outside
      `useEffect`/`useCallback`.
- [ ] Authenticated callbacks early-return when token null.

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
- [ ] **Hot read?** Cached via `registerCache` with invalidation path (§4.4).
- [ ] **Entity cap?** Added to `entityLimits` + `withEntityLimit` (§4.9).
- [ ] **Multi-tenant?** Scoped by `companyId`+`systemId` with covering indexes
      (§3.1).
- [ ] **Mutates actor validity?** Cache updated same request (§4.2).
- [ ] **User-generated text?** Standardize → validate → dedupe before write
      (§4.8).
- [ ] **Schedules something?** Event queue with idempotent handler + retry
      (§5.1).
- [ ] **Touches composable?** Parent holds link; no back-pointer; batched
      mutations (§3.3).
- [ ] **Charges money?** `payment` row before charge; async flows set
      `continuityData`+`expiresAt` (§7.5, §7.6).
- [ ] **Delivers messages?** `send_communication` + canonical template; no
      bespoke template (§5.2, §5.3).
- [ ] **Needs human confirmation?** `communicationGuard` +
      `verification_request` — no state mutation before click (§4.12).
- [ ] **Write invalidates cache?** Mutation path lists its
      `updateCache`/`reload()` call (§2.8).
- [ ] **Relies on per-instance state?** Acknowledge in-memory rate limit /
      actor-validity / file-cache caveat (§4.4).

---

## 17. Final Pass

- [ ] No dead comments, `// removed`, or backwards-compat shims for changed
      code.
- [ ] No new abstractions beyond task requirements.
- [ ] AGENTS.md (root or subsystem/framework) updated when contracts changed.
- [ ] New i18n keys in both `en` and `pt-BR`.
- [ ] New DB table/field has `src/contracts/` type used by route and frontend.
