# Multi-Tenant Platform — AGENTS

A compact, deterministic specification. Every rule in this document is
load-bearing. Nothing is decorative.

---

## Part A — Project Identity

### 1. Overview

A serverless multi-tenant platform. **Users** authenticate once, belong to one
or more **companies**, and subscribe each company to one or more **systems** via
a **plan**. A **superuser** administers the Core (systems, roles, plans, menus,
vouchers, settings, terms, data deletion). Each system renders its own UI,
menus, and features according to the active plan and user roles.

Every system additionally ships a **public homepage** (`.tsx` component
registered in the homepage registry) accessible at `/?system=<slug>`. The core
setting `app.defaultSystem` determines which homepage is rendered when no
`?system=` is provided. If nothing matches, a core fallback homepage is shown.
All public pages (homepage, auth pages, terms) receive system branding (logo +
name) through the same `?system=` parameter.

**Subframeworks** (§26) extend the Core at build time as self-contained,
namespace-isolated modules under `frameworks/<name>/`. Each framework owns its
own `AGENTS.md`, API routes, queries, migrations, components, and i18n files —
never mixed into Core folders. **Systems** are runtime tenants; subframeworks
are design-time code bundles.

### 1.1 Runtime invariants (non-negotiable)

1. **Serverless runtime.** Only standard Web APIs (`fetch`, `crypto`, `Request`,
   `Response`, …). No Node/Deno/Bun-specific APIs.
2. **Mobile-first responsive UI.** Build the most visually stunning interface
   possible with Tailwind only.
3. **Spinner on every AJAX.** Not just form submits — initial loads, deletes,
   inline adds, drag operations, every `fetch()` renders `<Spinner />` at the
   action's origin (button, content area, etc.).
4. **Searchable text fields use a configurable debounce.** Never un-debounced.
5. **Tailwind-only styling.** The only custom CSS allowed is the `:root`
   CSS-variables block in §4. Placeholders must use `placeholder-white/30`.
6. **Emojis instead of icon libraries.** No icon dependency.
7. **All UI text uses i18n keys** with `en` and `pt-BR` translations.
8. **Backend never returns human-readable text.** Validation errors, generic
   errors, file-upload errors, rate-limit errors — all i18n keys resolved by the
   frontend via `t()`. Shape: `{ code: "VALIDATION", errors: string[] }` or
   `{ code: "ERROR", message: "common.error.generic" }`.
9. **Communication templates use i18n keys.** Email/SMS templates call `t()` —
   never hardcode English.
10. **Compositional DB model.** Reusable structures (profile, address) are
    separate tables referenced via `record<>` links, never embedded. To create:
    `CREATE` the composable first, then the parent with the link. To update:
    update the composable directly. To delete: delete both parent and
    composable.

### 2. Tech Stack

| Layer         | Technology         | Version      |
| ------------- | ------------------ | ------------ |
| Framework     | Next.js            | 16           |
| Database      | SurrealDB          | 3.0          |
| Styling       | TailwindCSS        | 4.2          |
| Charts        | react-chartjs-2    | latest       |
| File storage  | @hviana/surreal-fs | latest (jsr) |
| Token/JWT     | @panva/jose        | latest (jsr) |
| HOTP and TOTP | otplib             | latest       |
| Language      | TypeScript         | strict mode  |

**Allowed packages (exhaustive — no others without explicit approval):**
`jsr:@hviana/surreal-fs`, `jsr:@panva/jose`, `npm:react-chartjs-2`,
`npm:chart.js` (peer of react-chartjs-2), `npm:surrealdb`, `npm:xlsx`.

---

## Part B — Global Conventions

### 3. Code & Style Baseline

- TypeScript strict mode. Contracts live in `src/contracts/` and are isomorphic.
- Web-APIs only (see §1.1.1). Never import `node:*`, `Deno.*`, `Bun.*`.
- Emojis for icons. No icon library imports.
- Mobile-first: every component designs for small screens first and scales up.

### 3.1 Component Reuse — Generic First

**Every new piece of UI must reuse an existing generic component before writing
ad-hoc markup.** If no suitable generic exists, the implementation must extract
one. This is a project-wide rule, not a suggestion — it applies to every page,
form, list, and control across the Core panel, subsystem panels, subframeworks,
and public pages.

The architecture is deliberately built around reusable primitives that compose
into complex interfaces. The following sections already enforce this pattern and
must be consulted before creating any new UI element:

- **Generic lists and list items** (`GenericList`, `GenericListItem` — §18.2):
  every entity listing — users, tokens, payments, tags, companies — uses the
  same paginated list with configurable field maps, control buttons, and action
  components. Never write a bespoke list with its own pagination, loading state,
  or empty-state rendering.
- **Generic specialized fields** (`MultiBadgeField`, `SearchableSelectField`,
  `DynamicKeyValueField`, `FileUploadField`, `TagSearch` — §18.4): structured
  data entry always delegates to these field components instead of plain inputs.
  The field-selection policy (§18.3) maps every data type to its required
  component.
- **Generic action buttons** (`CreateButton`, `EditButton`, `DeleteButton`,
  `GenericFormButton` — §18.1): standard entity-row controls with consistent
  styling, confirmation dialogs, and spinner integration. No per-page button
  reimplementations.
- **Generic list filters and search** (`SearchField`, `FilterDropdown`,
  `DateRangeFilter`, `FilterBadge` — §18.2): search, filtering, and badge
  rendering all flow through shared components with debounced inputs and
  composable filter configs.
- **Generic form modals** (`FormModal` — §18.2): creation and editing go through
  a shared modal that orchestrates subform collection, validation, submission,
  error display, and spinner state.
- **Shared subforms** (`ProfileSubform`, `ContactSubform`, `AddressSubform`,
  `CreditCardSubform`, `NameDescSubform` — §18.5): composable form sections that
  expose `getData()` + `isValid()` via `useImperativeHandle`. Any form that
  needs a profile, address, or credit card reuses the same subform — never
  duplicates its fields.
- **Compositional DB model** (§1.1.10, §7.1): reusable structures (`profile`,
  `address`) are separate tables linked via `record<>`, not embedded. Frontend
  responses resolve them via `FETCH`. This mirrors the component-level
  composition pattern — the same data is never entered or displayed twice.
- **Shared page components** (`BillingPage`, `UsagePage`, `UsersPage`,
  `PlanCard` — §18.10, §21): entire pages and cards are shared across contexts
  (billing, onboarding, core admin) via `variant` props, not duplicated per
  consumer.
- **Generic data export** (`DownloadData` — §18.1.1): XLSX exports always use
  the shared component with its built-in spinner and error handling.

**Pre-flight checklist before writing any new component:**

1. Does a shared component in `src/components/shared/`,
   `src/components/fields/`, or `src/components/subforms/` already handle this
   use case?
2. Can an existing component be extended with a new `variant`, optional prop, or
   render callback instead of creating a new file?
3. If neither applies, extract the new logic into a generic, prop-driven
   component under the appropriate shared directory so the next consumer can
   reuse it.

### 4. Visual Standard

Declare CSS variables in `app/globals.css` at `:root`. **These are the only
custom CSS declarations in the entire project.** Everything else is Tailwind
utilities.

```css
@import "tailwindcss";

:root {
  --color-primary-green: #02d07d;
  --color-hover-green: #02b570;
  --color-light-green: #00ff88;
  --color-secondary-blue: #00ccff;
  --color-black: #000000;
  --color-dark-gray: #333333;
  --color-light-text: #cccccc;
}
```

**Rules implemented via Tailwind utilities only:**

- Dark backgrounds with subtle gradients.
- Cards:
  `backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)]`.
- Hover:
  `hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20`.
- Gradient borders / accents:
  `bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)]`.
- Color roles: primary = `--color-primary-green`; accent =
  `--color-secondary-blue`; background = `--color-black`; borders =
  `--color-dark-gray`; secondary text = `--color-light-text`.
- **Inputs & textareas MUST use `placeholder-white/30`.** Never
  `placeholder-[var(--color-light-text)]/50`, never omit. Placeholder text
  itself comes from `t("common.placeholder.*")`. Labels follow the same rule —
  no hardcoded strings, always `t()`.

### 5. Internationalization (i18n)

#### 5.1 Structure

```
src/i18n/
├── en/ common.json auth.json core.json billing.json homepage.json
│      templates.json validation.json systems/{slug}.json
├── pt-BR/ (same)
└── index.ts          # loader + t(key, locale, params?)
```

#### 5.2 `t()` contract

```typescript
export function t(
  key: string, // "domain.section.label" e.g. "auth.login.title"
  locale: string,
  params?: Record<string, string>,
): string; // Returns the key itself as fallback if not found.
```

#### 5.3 Locale resolution (frontend — UI)

`src/hooks/LocaleProvider.tsx` wraps the app in the root layout, manages the
active locale, persists it in the `core_locale` cookie, and provides `t()` to
all descendants. Changing the locale re-renders consumers immediately (no
refresh).

**Order (first non-null wins):** (1) `core_locale` cookie → (2) browser
`navigator.languages` (best match against `supportedLocales`) → (3)
`System.defaultLocale` (per-system admin-configured) → (4) hardcoded `"en"`.

**Browser language matching** (step 2). Iterates `navigator.languages` (BCP 47
tag array, ordered by user preference) and selects the first supported locale.
Two-pass resolution:

1. **Exact match:** tag equals a `supportedLocales` entry (e.g. `"pt-BR"` →
   `"pt-BR"`).
2. **Prefix match:** tag's primary subtag matches (e.g. `"pt"` → `"pt-BR"`,
   `"en-US"` → `"en"`). Only the first prefix match is used.

If no entry matches, step 3 (`System.defaultLocale`) applies. This uses
`navigator.languages` (exposed by all modern browsers) rather than the
deprecated `navigator.language`, ensuring Safari, Firefox, Chrome, and Edge are
handled uniformly. The matching runs once on `LocaleProvider` mount; it never
re-executes on re-render.

There is no global `app.defaultLocale`. Each system owns its default.

When the user changes locale, the cookie is set and — if authenticated —
`PUT /api/users?action=locale` persists it on `user.profile.locale`, so
server-side operations (email/SMS) use the user's language even without cookie
access. `profile.locale` is also set at registration from the active frontend
locale.

`LocaleProvider` accepts an optional `defaultLocale` prop (the system's
`defaultLocale`). `(app)` layout and public pages (via `usePublicSystem`)
resolve it from the current system. On mount, the provider resolves the active
locale via the full chain (cookie → `defaultLocale` prop → browser → `"en"`) and
stores the result in state; subsequent re-renders reuse the stored value until
`setLocale()` is called.

#### 5.4 Locale resolution (server — email/SMS handlers)

Order: (1) `payload.locale` (caller passes user's `profile.locale` when
available) → (2) `System.defaultLocale` via `payload.systemSlug` → (3) `"en"`.

#### 5.5 `LocaleSelector`

`src/components/shared/LocaleSelector.tsx` — small dropdown on every page,
receives no props, reads from `LocaleContext`.

#### 5.6 DB-stored i18n keys

This rule applies to **display names and labels** — any DB field whose purpose
is to show readable text to users in the UI. Examples: role display names, plan
names, plan descriptions, menu labels, benefit strings, file access rule names.
These **MUST be i18n keys** (e.g. `"roles.admin.name"`,
`"plans.grexId.standard.name"`, `"core.fileAccess.names.companyLogos"`) and are
resolved at render time via `t()`.

This rule does **not** apply to machine-readable identifiers — system names,
system slugs, permission tokens, file category path patterns. These are
structural identifiers used for lookup, authorization, and routing; they are
never shown as-is to users and are outside the scope of the i18n rule.

#### 5.6.1 Standard translation structure for roles, permissions, entities, resources

Role names, granular permission tokens, entity names (used in plan
`entityLimits`), and resource keys (used in `maxOperationCount`, credit
expenses) are all machine-readable identifiers that nonetheless need to be
displayed in the UI. The project imposes a **single deterministic translation
structure** so `TranslatedBadge` (§18.1.2) can resolve every token by name,
regardless of whether the token belongs to the core, a system, or a framework.

| Identifier class | Core domain       | System domain                    | Framework domain                    |
| ---------------- | ----------------- | -------------------------------- | ----------------------------------- |
| Role name        | `roles.<name>`    | `systems.<slug>.roles.<name>`    | `frameworks.<name>.roles.<role>`    |
| Permission token | `permissions.<p>` | `systems.<slug>.permissions.<p>` | `frameworks.<name>.permissions.<p>` |
| Entity name      | `entities.<e>`    | `systems.<slug>.entities.<e>`    | `frameworks.<name>.entities.<e>`    |
| Resource key     | `resources.<k>`   | `systems.<slug>.resources.<k>`   | `frameworks.<name>.resources.<k>`   |

**File layout.**

- Core translations live at
  `src/i18n/{en,pt-BR}/{roles,permissions,entities,resources}.json` — one file
  per identifier class, flat key/value (e.g. `"superuser": "Superuser"` inside
  `roles.json`).
- System translations live at `src/i18n/{en,pt-BR}/systems/<slug>.json` and hold
  their role/permission/entity/resource strings under top-level `roles.*`,
  `permissions.*`, `entities.*`, `resources.*` dotted keys (the same file hosts
  the system's `menu.*`, `home.*`, etc.).
- Framework translations live at
  `frameworks/<name>/src/i18n/{en,pt-BR}/<name>.json` with the same `roles.*` /
  `permissions.*` / `entities.*` / `resources.*` sections.

**Dynamic key assembly.** `TranslatedBadge` builds its i18n key at render time
from `(kind, token, systemSlug?, frameworkName?)`. When `systemSlug` is present
the badge tries `systems.<slug>.<kind>s.<token>` first and falls back to
`<kind>s.<token>`. When `frameworkName` is present the first lookup is
`frameworks.<name>.<kind>s.<token>`. Consumers never hand-build these keys —
passing `{ kind: "resource", token, systemSlug }` is the only supported entry
point. (`kind` uses the singular form; the i18n segment uses the plural form:
`role` → `roles.*`, `permission` → `permissions.*`, `entity` → `entities.*`,
`resource` → `resources.*`.)

**Where both the key and the translation are shown.** Forms, administration
lists, token/connected-app cards, and anywhere an operator picks or edits
identifiers must render both the raw token and its translation via
`TranslatedBadge` (§18.1.2). The raw token is mandatory so the operator knows
what to type when referencing the identifier in code or config. The exception is
**user-facing surfaces where the identifier is informational only** — plan cards
(§18.10), the usage panel (§21.5), and the OAuth consent page (§24) — which
render the translation alone.

#### 5.7 Backend-never-returns-text rule

See §1.1.8. API error shapes:

- `{ success: false, error: { code: "VALIDATION", errors: ["validation.email.required", ...] } }`
- `{ success: false, error: { code: "ERROR", message: "common.error.generic" } }`

Applies to all validation errors, file-upload errors, rate-limit errors,
permission errors, and status messages.

### 6. Project File Structure

```
/
├── app/                              # Next.js 16 App Router
│   ├── globals.css                   # CSS vars ONLY (§4)
│   ├── layout.tsx                    # Root: locale provider, system context
│   ├── page.tsx                      # Public homepage (reads ?system=)
│   ├── (auth)/                       # No sidebar, reads ?system=
│   │   ├── login/ register/ verify/ forgot-password/ reset-password/ account-recovery/
│   │   ├── terms/page.tsx            # Public terms (new tab, ?system=)
│   │   └── oauth/authorize/page.tsx  # OAuth server page (§24)
│   ├── (app)/                        # Authenticated user panel
│   │   ├── layout.tsx                # Sidebar + profile menu + system logo
│   │   ├── onboarding/company|system/page.tsx
│   │   ├── entry/page.tsx             # Spinner-only landing pad
│   │   └── [...slug]/page.tsx        # Resolved by menu componentName
│   ├── (core)/                       # Superuser-only admin panel
│   │   ├── layout.tsx
│   │   ├── companies/ systems/ roles/ plans/ vouchers/ menus/ terms/
│   │   ├── data-deletion/ front-settings/ file-access/ settings/
│   └── api/
│       ├── public/{system,front-core}/route.ts
│       ├── auth/{login,register,verify,forgot-password,reset-password,password-change,refresh,exchange,oauth/[provider],oauth/authorize}/route.ts
│       ├── core/{systems,roles,plans,vouchers,menus,terms,companies,data-deletion,settings,settings/missing,front-settings,file-access}/route.ts
│       ├── users/route.ts
│       ├── companies/route.ts + [companyId]/systems/route.ts
│       ├── billing/route.ts
│       ├── usage/route.ts
│       ├── connected-apps/route.ts
│       ├── tokens/route.ts
│       ├── entity-channels/route.ts
│       ├── leads/{route.ts,public/route.ts}
│       ├── tags/route.ts
│       ├── files/{upload,download}/route.ts
│       └── systems/[system-slug]/.gitkeep
├── src/
│   ├── components/
│   │   ├── shared/   (§18.1 primitives, §18.6-18.9)
│   │   ├── subforms/ (§18.5)
│   │   ├── fields/   (§18.4)
│   │   ├── core/     (§20)
│   │   └── systems/registry.ts + [slug]/HomePage.tsx
│   ├── contracts/    (auth, tenant, profile, address, user, company,
│   │                  system, role, plan, voucher, menu, billing,
│   │                  connected-app, token, file, event-queue,
│   │                  communication, payment-provider, usage,
│   │                  core-settings, front-core-settings, tag, lead,
│   │                  location, entity-channel, file-access, common)
│   ├── i18n/         (§5.1)
│   ├── hooks/        (§17.3)
│   └── lib/          (formatters, validators — isomorphic, no secrets;
│                      db/connection.ts — frontend WebSocket for LIVE SELECT;
│                      payment/{interface,credit-card}.ts — client-side
│                      payment tokenization; queries/.gitkeep)
├── server/                           # Backend-only; NEVER imported by frontend
│   ├── db/
│   │   ├── connection.ts             # §7.8
│   │   ├── migrations/runner.ts + *.surql + systems/[slug]/*.surql
│   │   ├── seeds/runner.ts + 001_superuser.ts + 002_default_settings.ts + 003_default_front_settings.ts + 004_default_file_access.ts + systems/[slug]/*.ts
│   │   ├── queries/ (auth, users, companies, systems, roles, plans,
│   │   │            vouchers, menus, billing, connected-apps, tokens,
│   │   │            usage, event-queue, core-settings, tags, leads,
│   │   │            locations, data-deletion, entity-channels, systems/[slug]/)
│   │   └── frontend-queries/ (messages, notifications, systems/[slug]/)
│   ├── middleware/   (compose, withAuth, withRateLimit, withPlanAccess, withEntityLimit)
│   ├── utils/        (Core, FrontCore, cache, fs, token, token-revocation, cors,
│   │                  rate-limiter, usage-tracker, credit-tracker,
│   │                  entity-deduplicator, field-standardizer,
│   │                  field-validator, guards, tenant, verification-guard,
│   │                  communication/templates/*, payment/{interface,credit-card})
│   ├── event-queue/  (publisher, worker, registry, handlers/*)
│   ├── module-registry.ts            # §11.1 — central registration API
│   ├── core-register.ts              # Core self-registration (handlers + jobs)
│   └── jobs/         (index, start-event-queue, recurring-billing, token-cleanup, expire-pending-payments)
├── public/systems/[slug]/logo.svg
├── systems/                            # Subsystem boot (§12.9)
│   ├── index.ts                        # System boot entry — registers all systems
│   └── [slug]/
│       └── register.ts                 # Per-system self-registration
├── frameworks/                       # §26 — each subframework is self-contained
│   ├── index.ts                      # Framework boot entry (§26.4)
│   └── [name]/                       #   namespace-isolated; owns its own AGENTS.md
│       ├── AGENTS.md
│       ├── app/api/[name]/route.ts
│       ├── src/
│       │   ├── components/[name]/    # framework-specific components
│       │   ├── contracts/            # framework contracts
│       │   └── i18n/{en,pt-BR}/      # framework i18n files
│       └── server/
│           ├── db/migrations/        # framework migrations
│           ├── db/queries/           # framework queries
│           └── utils/                # framework utilities
├── tailwind.config.ts next.config.ts tsconfig.json package.json AGENTS.md database.json
```

**Rules:**

- Every empty structural folder contains a `.gitkeep`.
- Adding a new system **creates a subfolder `[slug]` in every one of**:
  `src/components/systems/`, `server/db/migrations/systems/`,
  `server/db/queries/systems/`, `server/db/frontend-queries/systems/`,
  `server/event-queue/handlers/systems/`, `app/api/systems/`, `public/systems/`,
  and `src/i18n/<locale>/systems/` for every locale.
- Each system **creates a `register.ts`** at `systems/[slug]/register.ts` (at
  the project root) that calls the module-registry registration functions
  (§12.9). The subsystem's `register()` function is imported only by
  `systems/index.ts` — never by core files.
- **System-specific migrations** live in
  `server/db/migrations/systems/[slug]/*.surql` and use the same numeric prefix
  convention (e.g. `0026_create_foo.surql`). The runner scans the root
  migrations directory, every `systems/<slug>/` subfolder, and every
  `frameworks/*/server/db/migrations/` subtree; merges them; sorts by numeric
  prefix globally; executes pending ones; records them in `_migrations` with the
  relative path (e.g. `systems/grex-id/0026_create_face.surql`).

---

## Part C — Data Layer

### 7. Database Conventions (SurrealDB)

#### 7.1 Core rules

- All tables are `SCHEMAFULL`.
- Passwords stored with `crypto::argon2::generate()`; verified with
  `crypto::argon2::compare()`. Never hashed in app code.
- **Compositional model** (§1.1.10): reusable structures (`profile`, `address`)
  are separate tables linked via `record<>`. Frontend responses include the full
  nested object resolved via SurrealDB `FETCH`.
- **Cursor-based pagination everywhere.** Never `SKIP`. Frontend supplies
  `limit`, capped server-side at 200.
- **FULLTEXT search** for textual lookup fields (see migration files for the
  `FULLTEXT ANALYZER general_analyzer_fts BM25` indexes on names).
- **Queries live in `server/db/queries/`**, never inlined in route handlers.

#### 7.1.1 Sensitive data must never be stored plainly

**Sensitive information is never written to the database as plaintext — at rest,
ever.** This rule applies to every table, every field, every migration, every
seed, every framework, and every subsystem. The options, in order of preference:

1. **Do not store it at all.** Passwords are the canonical example — we store an
   argon2 hash (§7.1) and verify on demand; the plaintext is discarded after the
   argon2 call and never touches a column.
2. **External tokenization.** Card numbers, API secrets that belong to a third
   party, payment instruments — push to a gateway / secret manager / vault, and
   store only the opaque token or id it returns. The token carries no sensitive
   data on its own.
3. **Encryption at rest (last resort).** When the runtime genuinely needs the
   plaintext later (e.g. symmetric shared secrets like TOTP keys that must be
   re-derived at verify time) and no external vault is available, the value is
   stored as AES-256-GCM ciphertext produced by the shared wrapper (§12.15).
   Plaintext lives in memory only for the duration of a single request and is
   never logged, cached to disk, or placed in another column.

**What counts as sensitive:** passwords, card / PAN / CVV data, raw API tokens
and refresh tokens (the wrapper uses hashes + `jti` revocation — §12.8 — not
plaintext), OAuth client secrets, TOTP shared secrets (`twoFactorSecret`,
`pendingTwoFactorSecret` — §19.15), private keys, PII that regulation flags as
restricted. When in doubt, treat it as sensitive.

**What this rule forbids:**

- Migrations that add a `string` field holding plaintext password / card / token
  / key material.
- Seeds or queries that INSERT such plaintext. Use the §12.15 wrapper or a
  tokenization call.
- Debug logs, error messages, `console.log`, or any other egress path that
  prints the plaintext after decryption.
- Copying ciphertext into `verification_request.payload`, `send_communication`
  `templateData`, live-query-readable tables, or any other surface listed in
  §15.1 rule 5.

**What this rule requires in practice.** Every field that holds encrypted
sensitive data uses `server/utils/crypto.ts` (§12.15) on every write and every
read; the DB column stays `TYPE option<string>` storing the `iv:tag:ciphertext`
triplet base64-encoded. The column name makes the encryption explicit (e.g. a
future codebase rename of `twoFactorSecret` to `twoFactorSecretEnc` is
encouraged but not required for backwards compatibility). The key used by the
wrapper is sourced from a Core setting that is loaded at boot and clearable only
by redeploy — it is NOT editable by the superuser panel.

#### 7.2 Single-call rule (transaction safety)

The backend uses a single shared SurrealDB connection. **Every query function
must batch all statements into one `db.query()` call.** Never sequential
`await db.query()` within the same function; never `Promise.all` of multiple
`db.query()`. Separate calls create implicit transactions that conflict under
concurrency, producing `"Transaction conflict: Resource
busy"`.

Pass values between statements with `LET`. Use `UPSERT … WHERE` instead of
read-then-write. The final `SELECT … FETCH` (to resolve record links) must be
part of the same batched query.

**Example — create a user with a composable profile and an email
`entity_channel`, then return the fully resolved row in one call:**

```surql
LET $prof = CREATE profile SET name = $name, locale = $locale, channels = [];
LET $u    = CREATE user    SET passwordHash = crypto::argon2::generate($password),
                               profile = $prof[0].id,
                               roles = [];
LET $ch   = CREATE entity_channel SET
              ownerId = $u[0].id, ownerType = "user",
              type = "email", value = $email, verified = false;
UPDATE $prof[0].id SET channels = [$ch[0].id];
SELECT * FROM user WHERE id = $u[0].id FETCH profile, profile.channels;
```

#### 7.3 Mandatory query-layer helpers

Every creation/update path MUST delegate to these utilities — no ad-hoc
`trim()`, validation regex, or duplicate-check queries in route handlers.

| Step                     | Utility (§12)                      | Order             |
| ------------------------ | ---------------------------------- | ----------------- |
| Normalize raw input      | `standardizeField`                 | Before all        |
| Reject invalid values    | `validateField` / `validateFields` | After standardize |
| Reject duplicates        | `checkDuplicates`                  | Before `CREATE`   |
| Enforce plan entity caps | `withEntityLimit` middleware       | Before `CREATE`   |

#### 7.4 Backend connection (`server/db/connection.ts`)

HTTP connection (not WebSocket) for serverless compatibility. Credentials read
from `database.json` (root directory) via `Core.DB_*` statics. Singleton
`getDb()`:

```typescript
let dbInstance: Surreal | null = null;
export async function getDb(): Promise<Surreal> {
  if (!dbInstance) {
    dbInstance = new Surreal();
    await dbInstance.connect(Core.DB_URL, {/* auth */});
    await dbInstance.use({
      namespace: Core.DB_NAMESPACE,
      database: Core.DB_DATABASE,
    });
  }
  return dbInstance;
}
```

#### 7.5 Frontend connection (`src/lib/db/connection.ts`)

WebSocket using SurrealDB user/password authentication. Exclusively for
`LIVE
SELECT`. Connection parameters (URL, namespace, database, user, password)
are read from `setting` rows via the public API (`GET /api/public/front-core`
resolves `db.frontend.*` keys). `connectFrontendDb()`.

| `setting` key           | Seed value                  | Used by             |
| ----------------------- | --------------------------- | ------------------- |
| `db.frontend.url`       | `"ws://127.0.0.1:8000/rpc"` | WebSocket endpoint  |
| `db.frontend.namespace` | `"main"`                    | SurrealDB namespace |
| `db.frontend.database`  | `"grex-id"`                 | SurrealDB database  |
| `db.frontend.user`      | `""`                        | SurrealDB auth user |
| `db.frontend.pass`      | `""`                        | SurrealDB auth pass |

#### 7.6 Live Query Permissions

- **Only `LIVE SELECT` is allowed from the frontend.**
- Every table used by frontend queries MUST declare
  `PERMISSIONS FOR select WHERE <ownership>` (e.g. `WHERE userId = $auth.id`).
- Always include cursor pagination with a reasonable limit.
- The frontend WebSocket authenticates via SurrealDB user/password credentials
  from `setting` (§7.5), not the system API token.

Example:

```surql
DEFINE TABLE notification SCHEMAFULL
  PERMISSIONS
    FOR select WHERE userId = $auth.id
    FOR create NONE FOR update NONE FOR delete NONE;
```

#### 7.7 Migration & seed runners

- `server/db/migrations/runner.ts` — tracks applied migrations in `_migrations`
  (UNIQUE `name`), scans root + `systems/<slug>/` + every
  `frameworks/<name>/server/db/migrations/` subtree, sorts by numeric prefix
  globally, executes pending in a transaction, records the relative path.
- `server/db/seeds/runner.ts` — scans root + `systems/<slug>/` + every
  `frameworks/<name>/server/db/seeds/` subtree for `NNN_*.ts` files, sorts by
  numeric prefix globally, dynamically imports each, and calls the exported
  `seed(db)` function. Each seed file must export
  `async function seed(db:
  Surreal): Promise<void>` and be idempotent (check
  existence before inserting). Example: superuser seed skips if
  `SELECT * FROM user WHERE roles CONTAINS
  "superuser"` is non-empty.

### 8. Schema Index

All `DEFINE TABLE` / `DEFINE FIELD` / `DEFINE INDEX` statements live in the
migration files below. Read the files directly for exact DDL. Each migration
creates exactly one table; the rules that matter for app code are summarized in
this table.

| Migration file                             | Table                     | Key rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_db_generals.surql`                   | `_migrations`, analyzers  | Analyzer `general_analyzer_fts` used by FULLTEXT indexes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `0001_create_user.surql`                   | `user`                    | `profile` is `record<profile>`. `passwordHash` via argon2. Identity values (email/phone/etc.) live on `entity_channel` rows linked through `profile.channels`. Fields: passwordHash, profile, roles, twoFactorEnabled, twoFactorSecret, oauthProvider, stayLoggedIn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `0002_create_company.surql`                | `company`                 | `billingAddress` is `option<record<address>>`. Unique `document`. `ownerId` → user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0003_create_company_user.surql`           | `company_user`            | Unique `(companyId, userId)`. Pure association.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `0004_create_system.surql`                 | `system`                  | Unique `slug`. Fields: name, slug, logoUri, defaultLocale, termsOfService, createdAt, updatedAt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `0005_create_company_system.surql`         | `company_system`          | Unique `(companyId, systemId)`. Idempotent creation (§22.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `0006_create_user_company_system.surql`    | `user_company_system`     | Unique `(userId, companyId, systemId)`. Per-(company+system) roles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0007_create_role.surql`                   | `role`                    | Unique `(name, systemId)`. `isBuiltIn` flag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `0008_create_plan.surql`                   | `plan`                    | `entityLimits` `option<object> FLEXIBLE`. `planCredits` int default 0. `fileCacheLimitBytes` int default 20971520 (20 MB). `maxConcurrentDownloads` int default 0 (0 = unlimited). `maxConcurrentUploads` int default 0 (0 = unlimited). `maxDownloadBandwidthMB` float default 0 (0 = unlimited). `maxUploadBandwidthMB` float default 0 (0 = unlimited). `maxOperationCount` `option<object> FLEXIBLE` — per-resourceKey map (e.g. `{"faceDetection": 100}`). `isActive` default true. Fields: name, description, systemId, price, currency, recurrenceDays, benefits, permissions, entityLimits, apiRateLimit, storageLimitBytes, fileCacheLimitBytes, planCredits, maxConcurrentDownloads, maxConcurrentUploads, maxDownloadBandwidthMB, maxUploadBandwidthMB, maxOperationCount, isActive. |
| `0009_create_voucher.surql`                | `voucher`                 | Unique `code`. `applicableCompanyIds` array of record (empty = universal). `applicablePlanIds` array of record (empty = valid for every plan) — §22.7. Modifiers: priceModifier, apiRateLimitModifier, storageLimitModifier, fileCacheLimitModifier, entityLimitModifiers, creditModifier, maxConcurrentDownloadsModifier, maxConcurrentUploadsModifier, maxDownloadBandwidthModifier, maxUploadBandwidthModifier, maxOperationCountModifier `option<object> FLEXIBLE` — per-resourceKey map.                                                                                                                                                                                                                                                                                                   |
| `0010_create_menu_item.surql`              | `menu_item`               | `parentId` optional, unlimited depth. Index on `(systemId, parentId, sortOrder)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `0011_create_subscription.surql`           | `subscription`            | See §22. `remainingPlanCredits`, `remainingOperationCount` `option<object> FLEXIBLE` (per-resourceKey map), `creditAlertSent`, `operationCountAlertSent` `option<object> FLEXIBLE` (per-resourceKey), `autoRechargeEnabled/Amount/InProgress`. Status ∈ `active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `0012_create_payment_method.surql`         | `payment_method`          | `billingAddress` is `record<address>`. `isDefault` bool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `0013_create_credit_purchase.surql`        | `credit_purchase`         | Status ∈ `pending`, `completed`, `failed`, `expired`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `0014_create_connected_app.surql`          | `connected_app`           | Scoped per (company, system). `apiTokenId` link to underlying `api_token` for revocation cascade. `maxOperationCount` `option<object> FLEXIBLE` — per-resourceKey map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `0015_create_api_token.surql`              | `api_token`               | `tenant` (`object FLEXIBLE`), `jti` unique, `neverExpires`, `frontendUse`, `frontendDomains`, `revokedAt`, `maxOperationCount` `option<object> FLEXIBLE` (per-resourceKey map). Indexes on `tokenHash` UNIQUE, `jti` UNIQUE, `revokedAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `0017_create_usage_record.surql`           | `usage_record`            | `actorType ∈ user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `0018_create_queue_event.surql`            | `queue_event`             | `payload` `object FLEXIBLE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `0019_create_delivery.surql`               | `delivery`                | Status ∈ `pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `0020_create_core_setting.surql`           | `setting`                 | Unique `(key, systemSlug)`. `systemSlug string` — the literal `"core"` is the core-level default; any other non-empty value is a per-system override. `systemSlug` MUST NOT be empty (`ASSERT $value != ""`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `0021_create_verification_request.surql`   | `verification_request`    | `actionKey` i18n string (e.g. `"auth.action.register"`). `ownerId` `record<user\|lead>` for the entity being confirmed. `payload` `object FLEXIBLE` (no sensitive data — never passwords, card numbers, tokens). `companyId`/`systemId`/`systemSlug`/`actorId`/`actorType` capture tenant context. Unique `token`. Index on `(ownerId, actionKey, createdAt)`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `0022_create_live_query_permissions.surql` | various                   | Applies `PERMISSIONS FOR select WHERE …` per §7.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `0023_create_lead.surql`                   | `lead`                    | `profile` is `record<profile>`. Identity values (email/phone/etc.) live on `entity_channel` rows linked through `profile.channels`. `companyIds` array of record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `0024_create_lead_company_system.surql`    | `lead_company_system`     | Unique `(leadId, companyId, systemId)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `0025_create_location.surql`               | `location`                | Scoped per (company, system). Embeds `address` inline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `0029_create_tag.surql`                    | `tag`                     | Scoped per (company, system). Unique `(name, companyId, systemId)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0030_create_profile.surql`                | `profile`                 | Composable. Fields: name, avatarUri, age, locale, channels (`array<record<entity_channel>>`). FULLTEXT `name`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `0031_create_address.surql`                | `address`                 | Composable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `0032_create_credit_expense.surql`         | `credit_expense`          | Daily container. Unique `(companyId, systemId, resourceKey, day)`. Fields: `amount` (total cents consumed), `count` (number of individual consumptions), `actorId` `option<string>`. Both increment atomically via UPSERT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `0033_create_front_core_setting.surql`     | `front_setting`           | Unique `(key, systemSlug)`. `systemSlug string` — same rule as `setting`: the literal `"core"` is the core-level default, any other non-empty value is a per-system override, and `systemSlug` MUST NOT be empty (`ASSERT $value != ""`). Physically separated from `setting` (§10.2.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `0034_create_token_revocation.surql`       | `token_revocation`        | JTI-based revocation. Unique `jti`. Rows TTL to original `exp` — bounded automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `0035_create_entity_channel.surql`         | `entity_channel`          | Composable, generalized communication channel. `ownerId` `record<user\|lead>`. `ownerType` ∈ `["user","lead"]` — denormalized for cheap filtering. `type` open string identifying the channel (seeded defaults `"email"`, `"phone"`; subframeworks may register their own). `value` string. `verified` bool default false. Unique `(ownerId, type, value)`. Index on `(type, value)` and on `(ownerId, verified)`. Max per owner enforced at the query layer via `auth.entityChannel.maxPerOwner`.                                                                                                                                                                                                                                                                                              |
| `0038_create_payment.surql`                | `payment`, `subscription` | Unified payment ledger. `payment`: companyId, systemId, subscriptionId, amount, currency, kind (`"recurring"\|"credits"\|"auto-recharge"`), status (`"pending"\|"completed"\|"failed"\|"expired"`), paymentMethodId, transactionId, invoiceUrl, failureReason, continuityData (`option<object> FLEXIBLE`), expiresAt (`option<datetime>`), createdAt. Indexes on (companyId, systemId), createdAt, kind, (status, expiresAt). Also adds `retryPaymentInProgress: bool DEFAULT false` to `subscription`.                                                                                                                                                                                                                                                                                         |
| `0044_create_file_access.surql`            | `file_access`             | File access control rules. Unique `name`. FULLTEXT `name`. Fields: name, categoryPattern, download (object FLEXIBLE with isolateSystem, isolateCompany, isolateUser, permissions), upload (same shape plus maxFileSizeMB option<float> and allowedExtensions array<string>), createdAt. See §13.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**File-metadata note:** `@hviana/surreal-fs` manages its own
`surreal_fs_files` + `surreal_fs_chunks` tables via `fs.init()` — there is no
separate `file_metadata` table (§13.5).

**Seed files:**

- `001_superuser.ts` — creates the superuser if none exists. Creates a `profile`
  (display name from `app.name` or `"Super Admin"` fallback) **plus** one
  verified `entity_channel` of type `"email"` linked to the profile, and
  attaches the superuser `user` to that profile. The verified channel is what
  satisfies the approval invariant (§19.3) so the superuser can log in from
  first boot, and it also enables the recovery / profile flows that expect at
  least one verified channel.
- `002_default_settings.ts` — seeds the server-only Core settings table
  (§10.1.4).
- `003_default_front_settings.ts` — seeds the FrontCore table (§10.2.6).
- `004_default_file_access.ts` — seeds default file access rules for logos,
  avatars, and lead avatars (§13.7).

---

## Part D — Backend

### 9. Tenant — the single source of request context

Every authenticated and unauthenticated request, job, worker, and handler
operates against a **Tenant** object. Tokens embed it; middleware decodes it;
route handlers, queries, jobs, and event handlers read `ctx.tenant`. The
frontend never manipulates the Tenant directly — it holds only the opaque token;
`useAuth().token` passes it as `Authorization: Bearer`.

#### 9.1 Contract (`src/contracts/tenant.ts`)

```typescript
export interface Tenant {
  systemId: string; // "0" for unauthenticated / non-tenant contexts
  companyId: string; // "0" for unauthenticated / non-tenant contexts
  systemSlug: string; // "core" for core-scoped routes; else the system slug
  roles: string[]; // [] for anonymous / app-token tenants
  permissions: string[]; // [] for anonymous; "*" wildcard allowed
}

export type TenantActorType =
  | "user"
  | "api_token"
  | "connected_app"
  | "anonymous";

export interface TenantClaims extends Tenant {
  actorType: TenantActorType;
  actorId: string; // user/token/app id; "0" for anonymous
  jti: string; // unique token id (revocation §19.12)
  exchangeable: boolean; // true only for actorType="user"
}
```

#### 9.2 Rules

1. **Unauthenticated requests always receive a synthetic Tenant** — never
   `null`. `systemId = "0"`, `companyId = "0"`, empty `roles`/`permissions`.
   `systemSlug = "core"` when the route is core-scoped (`/api/core/*`,
   `/api/auth/*`, `/api/public/*` without a `system` param); otherwise it is the
   resolved system slug (e.g. `/api/public/system?slug=grex-id` or
   `/api/systems/grex-id/*`).
2. **Backend code never reads** `companyId`/`systemId`/`roles`/`permissions`
   **from query strings, cookies, or request bodies.** These come from the
   Tenant only. Changing the tenant requires a token exchange (§19.11).
3. **Queries, event handlers, jobs, and workers** accept `tenant: Tenant` (or a
   `ctx` that contains it) — not loose IDs. This includes every query in
   `server/db/queries/` and every utility that needs scoping
   (`trackCreditExpense`, `consumeCredits`, `trackUsage`, `standardizeField`,
   `validateField`, `checkDuplicates`, etc.).
4. **Jobs without a user context** construct a system Tenant via
   `getSystemTenant()` — `systemId = "0"`, `companyId = "0"`,
   `systemSlug = "core"`, `roles = ["superuser"]`, `permissions = ["*"]`. This
   helper is the only place such a tenant is built.
5. **Token exchange is the sole mechanism to change Tenant** (§19.11). App
   tokens and connected-app tokens carry `exchangeable: false` and are bound for
   life to their issue-time Tenant.

#### 9.3 Helpers (`server/utils/tenant.ts`)

```typescript
export function getSystemTenant(): Tenant;
export function getAnonymousTenant(systemSlug: string): Tenant;
export function assertScope(
  tenant: Tenant,
  required: { companyId?: string; systemId?: string },
): void; // throws 403 on mismatch
```

### 10. Configuration Singletons

Both singletons use the centralized cache registry (§12.11) for all data
storage: lazy load on first access, in-memory cache, reload on write,
missing-key log, admin editor.

#### 10.1 Core (server-only)

**Contract (`server/utils/Core.ts`):**

```typescript
class Core {
  static readonly DB_URL: string; // from database.json
  static readonly DB_USER: string;
  static readonly DB_PASS: string;
  static readonly DB_NAMESPACE: string;
  static readonly DB_DATABASE: string;

  // All data backed by cache registry (§12.11) under "core"::"data".

  // When systemSlug is provided, returns the system-specific value if it exists,
  // otherwise falls back to the core-level default (systemSlug = "core").
  // When omitted, returns the core-level default directly.
  async getSetting(
    key: string,
    systemSlug?: string,
  ): Promise<string | undefined>;
  async getSystemBySlug(slug: string): Promise<System | undefined>;
  async getRolesForSystem(systemId: string): Promise<Role[]>;
  async getPlansForSystem(systemId: string): Promise<Plan[]>;
  async getMenusForSystem(systemId: string): Promise<MenuItem[]>;
  async getMissingSettings(): Promise<
    { key: string; firstRequestedAt: string }[]
  >;
  async reload(): Promise<void>; // delegates to updateCache("core", "data")
  static getInstance(): Core;

  // Plan / voucher lookup (async, from cache)
  async getPlanById(planId: string): Promise<Plan | undefined>;
  async getVoucherById(voucherId: string): Promise<Voucher | undefined>;

  // Subscription cache (lazily loaded, per-tenant, backed by cache registry)
  async getActiveSubscriptionCached(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | undefined>;
  async ensureSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null>;
  async reloadSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null>;
  evictAllSubscriptions(): void;
}
```

**Server-only guard** — at the top of the file, use the shared
`assertServerOnly(fileName)` helper from `server/utils/server-only.ts` (§12.14):

```typescript
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("Core");
```

**Backend database credentials.** The static `DB_*` fields are read at class
load time from `database.json` in the project root:

```json
{
  "url": "https://…",
  "user": "admin",
  "pass": "…",
  "namespace": "main",
  "database": "grex-id"
}
```

This file is server-only (never imported by frontend code) and should be
excluded from version control (`.gitignore`).

**Frontend database credentials.** The frontend WebSocket connection reads its
parameters from `setting` rows (`db.frontend.url`, `db.frontend.namespace`,
`db.frontend.database`, `db.frontend.user`, `db.frontend.pass` — see §7.5).
These are resolved at runtime via `GET /api/public/front-core`, keeping all
connection configuration in the database where the superuser can update it
without redeployment.

**Reload trigger.** Whenever a core entity is written (systems, roles, plans,
vouchers, menus, settings), the route handler calls
`Core.getInstance().reload()`, which delegates to `updateCache("core", "data")`
(§12.11). This also clears any derived caches (e.g. JWT secret).

**Subscription cache.** Active subscriptions are cached per-tenant via the
centralized cache registry (§12.11) under
`"core"::"sub:<companyId>:<systemId>"`. Entries are registered on first access
and loaded lazily. After any billing mutation (subscribe, cancel, apply_voucher,
set_auto_recharge, purchase_credits) the route handler or event handler calls
`Core.getInstance().reloadSubscription(companyId, systemId)`, which delegates to
`updateCache`. The process-payment handler reloads subscriptions after renewal
and after marking past_due. The `evictAllSubscriptions()` method iterates all
tracked subscription cache keys and calls `clearCache` on each; it is called
after voucher mutations (which can cascade across multiple tenants).

**Index maps — no array iteration.** The Core data loader (`loadCoreData`)
builds pre-built `Map` indexes for O(1) lookups: `systemsBySlug`,
`rolesBySystem`, `plansBySystem`, `menusBySystem`, `plansById`, `vouchersById`,
and `settings`. These are part of the `CoreData` object stored in the cache
registry (§12.11). This rule applies to all caching mechanisms in the project —
design for O(1) lookups, never iterate.

**No hardcoded fallback constants.** Server-side config is read exclusively via
`Core.getInstance().getSetting(key)` or
`Core.getInstance().getSetting(key,
systemSlug)`. If a key is missing,
`getSetting` returns `undefined` and the key is logged.

##### 10.1.4 Core settings (seeded by `002_default_settings.ts` into `setting` table)

| Key                                       | Seed value                        | Used by                                                                                                                                            |
| ----------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.name`                                | `"Core"`                          | Email templates (`appName`)                                                                                                                        |
| `app.baseUrl`                             | `"http://localhost:3000"`         | Verification/reset links                                                                                                                           |
| `app.defaultSystem`                       | `""`                              | Homepage fallback system slug                                                                                                                      |
| `auth.token.expiry.minutes`               | `"15"`                            | System API token lifetime                                                                                                                          |
| `auth.token.expiry.stayLoggedIn.hours`    | `"168"`                           | Stay-logged-in lifetime (7 days)                                                                                                                   |
| `auth.rateLimit.perMinute`                | `"5"`                             | Auth route rate limit                                                                                                                              |
| `auth.communication.expiry.minutes`       | `"15"`                            | Unified verification/communication token expiry (min)                                                                                              |
| `auth.communication.maxCount`             | `"5"`                             | Max sends per (owner, actionKey) in rolling window                                                                                                 |
| `auth.communication.windowHours`          | `"1"`                             | Rolling window for communication rate limit (hours)                                                                                                |
| `auth.oauth.providers`                    | `"[]"`                            | JSON array of enabled OAuth providers. Empty = OAuth login disabled (no redundant flag needed).                                                    |
| `auth.encryption.key`                     | `"dev-only-change-in-production"` | 32-byte AES-256-GCM key (base64) used by the field encryption wrapper (§12.15). MUST be overridden per deploy — the seeded value is a placeholder. |
| `terms.generic`                           | `""`                              | Generic LGPD fallback HTML                                                                                                                         |
| `billing.autoRecharge.minAmount`          | `"500"`                           | Min auto-recharge (cents)                                                                                                                          |
| `billing.autoRecharge.maxAmount`          | `"50000"`                         | Max auto-recharge per subscription (cents)                                                                                                         |
| `auth.entityChannel.maxPerOwner`          | `"10"`                            | Max entity channels per owner (user or lead)                                                                                                       |
| `auth.entityChannel.defaultTypes`         | `"[\"email\",\"phone\"]"`         | JSON array of seeded channel types                                                                                                                 |
| `auth.communication.defaultChannels`      | `"[\"email\",\"sms\"]"`           | JSON array of channels used by system-wide communications when the caller omits `channels`; order defines fallback precedence                      |
| `db.frontend.url`                         | `"ws://127.0.0.1:8000/rpc"`       | Frontend WebSocket endpoint (§7.5)                                                                                                                 |
| `db.frontend.namespace`                   | `"main"`                          | Frontend SurrealDB namespace (§7.5)                                                                                                                |
| `db.frontend.database`                    | `"grex-id"`                       | Frontend SurrealDB database (§7.5)                                                                                                                 |
| `db.frontend.user`                        | `""`                              | SurrealDB auth user for frontend WebSocket                                                                                                         |
| `db.frontend.pass`                        | `""`                              | SurrealDB auth pass for frontend WebSocket                                                                                                         |
| `cache.core.size`                         | `"20"`                            | Core file cache size (MB)                                                                                                                          |
| `cache.file.hitWindowHours`               | `"1"`                             | Sliding window for cache hit counting (hours)                                                                                                      |
| `transfer.default.maxConcurrentDownloads` | `"0"`                             | Default max concurrent downloads (0 = unlimited)                                                                                                   |
| `transfer.default.maxConcurrentUploads`   | `"0"`                             | Default max concurrent uploads (0 = unlimited)                                                                                                     |
| `transfer.default.maxDownloadBandwidthMB` | `"0"`                             | Default max download bandwidth MB/s (0 = unlimited)                                                                                                |
| `transfer.default.maxUploadBandwidthMB`   | `"0"`                             | Default max upload bandwidth MB/s (0 = unlimited)                                                                                                  |

**Missing settings log.** Keys requested via `getSetting()` that aren't in the
DB are recorded with a timestamp. `reload()` clears any that have since been
defined. `/api/core/settings/missing` exposes the log; the settings panel
renders a warning banner with an "Add all missing" button that pre-fills them as
new rows.

#### 10.2 FrontCore (server-only)

Mirrors Core for frontend-safe settings. **Server-only** — includes the same
`typeof window` guard as `Core.ts` and must never be imported in frontend code.
Frontend consumers use `useFrontCore` (§17.3) which calls the public API route
directly.

- Reads exclusively from `front_setting` (never `setting`).
- Reads DB directly through the shared connection.
- Admin writes via `PUT /api/core/front-settings`: updates DB → calls
  `FrontCore.getInstance().reload()`, which delegates to
  `updateCache("core", "front-data")` (§12.11) → broadcasts invalidation to open
  clients (live SELECT on `front_setting`, when the user's SurrealDB token has
  select permission).

**Contract:**

```typescript
class FrontCore {
  // Same fallback logic as Core: system-specific → core-level default.
  // Data backed by cache registry (§12.11) under "core"::"front-data".
  async getSetting(
    key: string,
    systemSlug?: string,
  ): Promise<string | undefined>;
  async getMissingSettings(): Promise<
    { key: string; firstRequestedAt: string }[]
  >;
  async reload(): Promise<void>; // delegates to updateCache("core", "front-data")
  static getInstance(): FrontCore;
}
```

##### 10.2.6 FrontCore settings (seeded by `003_default_front_settings.ts` into `front_setting` table)

| Key                                         | Seed value           | Used by                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `front.app.name`                            | `"Core"`             | Tab title, public page headers                                                                                                                                                                                                                                                                                                                                                      |
| `front.app.brandPrimaryColor`               | `"#02d07d"`          | Runtime theming                                                                                                                                                                                                                                                                                                                                                                     |
| `front.support.email`                       | `"support@core.com"` | Footer support link                                                                                                                                                                                                                                                                                                                                                                 |
| `front.support.helpUrl`                     | `""`                 | Help Center link                                                                                                                                                                                                                                                                                                                                                                    |
| `front.botProtection.siteKey`               | `""`                 | CAPTCHA / bot-protection client key                                                                                                                                                                                                                                                                                                                                                 |
| `front.payment.publicKey`                   | `""`                 | Payment gateway publishable key                                                                                                                                                                                                                                                                                                                                                     |
| `front.dataTracking.trackedCharacteristics` | `"[]"`               | JSON array of user characteristics that MUST NOT be tracked unless the data-tracking consent popup (§18.1.3) has been accepted. Seeded empty; the frontend reads it at runtime and only collects the listed characteristics once consent is recorded in the `core_data_tracking_consent` cookie. Additive — frameworks may introduce new characteristic names without core changes. |

##### 10.2.7 Admin panel

The superuser panel has **two separate pages**:

- `(core)/settings` → server-only `setting` editor.
- `(core)/front-settings` → `front_setting` editor.

Both include a **system selector dropdown** at the top. Selecting "Core
(default)" shows core-level settings (`systemSlug = "core"`). Selecting a
specific system shows only that system's overrides. Adding a setting while a
system is selected scopes it to that system. Both use `DynamicKeyValueField` +
missing-keys banner + "Add all missing" button (identical UX). A badge in each
header names which table is being edited (`t("core.settings.title")` vs
`t("core.frontSettings.title")`).

##### 10.2.8 Why separate tables

Physical separation guarantees the frontend bundle cannot accidentally leak a
server-only secret: a read permission granting `SELECT * FROM
front_setting`
never touches `setting`. Keys must never overlap.

### 11. Middleware Pipeline

Every API route uses `compose()` from `server/middleware/compose.ts`.

```typescript
type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

interface RequestContext {
  tenant: Tenant; // ALWAYS populated — never null (anonymous synthesized)
  claims?: TenantClaims; // Full decoded JWT when authenticated
  // No ad-hoc companyId/systemId/roles/userId — read from tenant/claims.
}
```

**Standard execution order:**

1. `withRateLimit(config)` — sliding window. Key: `{companyId}:{systemId}` for
   general routes; `{ip}` for auth routes. Reads `ctx.tenant`. Plan rate limit
   and voucher modifier from Core cache; only the actor count requires a DB
   query. Delegates to `resolveRateLimitConfig()` (§12.10).
2. `withAuth(options?)` — verifies the JWT, checks `jti` against the revocation
   list (§19.12), runs the CORS check (§12.7) for `frontendUse` tokens,
   populates `ctx.tenant` + `ctx.claims`. If no token, populates the anonymous
   Tenant.
   - Options: `{ roles?, permissions?, requireAuthenticated? }`.
   - **Superusers bypass all role/permission checks.**
   - If `roles` is provided, `ctx.tenant.roles` must contain at least one.
   - If `permissions` is provided, `ctx.tenant.permissions` must contain at
     least one listed entry OR the `"*"` wildcard.
   - Route handlers **never parse the `Authorization` header themselves**.
3. `withPlanAccess(featureNames[])` — verifies the subscription for the tenant
   is active and within `currentPeriodEnd`, and that the plan grants at least
   one of the listed permissions. Reads subscription and plan data from the Core
   cache (no DB query). Delegates to `checkPlanAccess()` (§12.10).
4. `withEntityLimit(entityName)` — (optional, before CREATE) checks the current
   entity count against plan limits + voucher modifiers.
   Plan/voucher/subscription data from Core cache; only the entity count
   requires a DB query. Delegates to `resolveEntityLimit()` (§12.10).

**Auth routes (`/api/auth/*`) only use `withRateLimit`.** They still receive the
synthesized anonymous `ctx.tenant` so downstream utilities keep the uniform
contract.

**Uniform tenant rule.** Every helper below the middleware layer (queries,
utilities, event handlers, jobs) accepts `tenant: Tenant` (never loose IDs). PR
review rejects any helper that reintroduces scattered context.

### 12. Cross-Cutting Backend Utilities

All of the following MUST be used — no ad-hoc reimplementations.

| File                                  | Purpose                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `server/utils/rate-limiter.ts`        | §12.1                                                                     |
| `server/utils/usage-tracker.ts`       | §12.2                                                                     |
| `server/utils/credit-tracker.ts`      | §12.3                                                                     |
| `server/utils/entity-deduplicator.ts` | §12.4                                                                     |
| `server/utils/field-standardizer.ts`  | §12.5                                                                     |
| `server/utils/field-validator.ts`     | §12.6                                                                     |
| `server/utils/cors.ts`                | §12.7                                                                     |
| `server/utils/token-revocation.ts`    | §12.8                                                                     |
| `server/utils/fs.ts`                  | `getFS()` — shared `SurrealFS` singleton for §13                          |
| `server/utils/tenant.ts`              | §9.3                                                                      |
| `server/utils/token.ts`               | JWT create/verify via `@panva/jose`, embeds Tenant                        |
| `server/module-registry.ts`           | §12.9 — central registration API for handlers, jobs, components           |
| `server/utils/guards.ts`              | §12.10 — internal guard functions for plan-limit enforcement              |
| `server/utils/cache.ts`               | §12.11 — centralized cache registry                                       |
| `server/utils/file-cache.ts`          | §12.12 — Sliding-Window Size-Aware LFU file cache                         |
| `server/utils/verification-guard.ts`  | §12.13 — unified communication guard (cooldown + rate limit)              |
| `server/utils/file-access-cache.ts`   | §13.7 — file access rule loader + pattern compiler                        |
| `server/utils/file-access-guard.ts`   | §13.7 — file access guard (tenant isolation + permissions)                |
| `server/utils/server-only.ts`         | §12.14 — shared guard preventing server files from loading in the browser |
| `server/core-register.ts`             | Core self-registration at boot                                            |

#### 12.1 Rate limiter

Sliding window, in-memory. Plan's `apiRateLimit` (plus voucher
`apiRateLimitModifier`) defines the global limit for a company+system.
Distributed across active actors (user + tokens + connected_apps):
`floor(globalLimit / activeActorCount)` with a minimum of 1 per actor. Per-route
overrides passed as `withRateLimit` config.

#### 12.2 Usage tracker

```typescript
async function trackUsage(params: {
  actorType: "user" | "token" | "connected_app";
  actorId: string;
  companyId: string;
  systemId: string;
  resource: string; // e.g. "storage_bytes", "credits"
  value: number;
}): Promise<void>;
```

Upserts `usage_record` for the current period (`YYYY-MM`). Called after
successful chargeable operations.

#### 12.3 Credit tracker

```typescript
// Records one expense (daily container, UPSERT increments amount and count)
async function trackCreditExpense(params: {
  resourceKey: string; // i18n key, e.g. "faceDetection"
  amount: number; // cents
  companyId: string;
  systemId: string;
}): Promise<void>;

export interface CreditDeductionResult {
  success: boolean;
  source: "plan" | "purchased" | "insufficient" | "operationLimit";
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
}

// Consumes credits atomically (plan first, then purchased).
// Also increments the credit_expense count for the resource key.
async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
}): Promise<CreditDeductionResult>;
```

`consumeCredits` must perform the entire deduction in a single batched
`db.query()` (§7.2). The complete algorithm including auto-recharge and one-shot
alert flag is in §22.3.

**Operation-count cap (per-resourceKey).** Before any credit deduction,
`consumeCredits` checks the subscription's
`remainingOperationCount[resourceKey]` (§22.6). If the remaining count for that
resourceKey is `0` (and the effective cap for that key is non-zero), the
operation is rejected with `{ success: false, source: "operationLimit" }` — no
credit alert or auto-recharge is triggered for this condition. The effective
per-key cap is resolved via `resolveMaxOperationCount({ ..., resourceKey })`
(§12.10). A missing or zero value means unlimited (no cap) for that key. On
successful credit deduction, `remainingOperationCount[resourceKey]` is
decremented by 1.

`remainingOperationCount` is set on subscribe/renew to the full merged map (plan
`maxOperationCount` + voucher `maxOperationCountModifier` per key via
`resolveAllOperationCounts()`), and the specific key is decremented by 1 on each
successful consumption. It resets on renewal.

#### 12.4 Entity deduplicator

```typescript
export interface DeduplicationField {
  field: string;
  value: unknown;
}
export interface DeduplicationResult {
  isDuplicate: boolean;
  conflicts: { field: string; value: unknown; existingRecordId: string }[];
}
export async function checkDuplicates(
  entity: string,
  fields: DeduplicationField[],
): Promise<DeduplicationResult>;
```

**Rules:**

- Call `checkDuplicates` **before** the `CREATE` query on any entity with a
  UNIQUE index or logical uniqueness (entity channels, company document, system
  slug, voucher code, tag name-per-scope, etc.).
- Pass every uniqueness field. `null`/`undefined` values are silently skipped
  (e.g. optional phone).
- Each field is checked independently so conflicts can be reported precisely for
  i18n error messages.

#### 12.5 Field standardizer

```typescript
export function standardizeField(
  field: string,
  value: string,
  entity?: string,
): string;
export function registerStandardizer(
  field: string,
  fn: (v: string) => string,
  entity?: string,
): void;
```

Resolution order: entity+field specific → generic field → default (`trim` +
strip `<>`).

| Field      | Transformation                                          |
| ---------- | ------------------------------------------------------- |
| `email`    | Trim, lowercase, collapse whitespace                    |
| `phone`    | Strip all non-digit characters                          |
| `name`     | Trim, collapse whitespace, remove `<>`                  |
| `slug`     | Trim, lowercase, spaces → hyphens, strip non-slug chars |
| `document` | Strip all non-digit characters                          |
| default    | Trim, remove `<>`                                       |

Call **before** validation and storage. Pass `entity` when known.

#### 12.6 Field validator

```typescript
export function validateField(
  field: string,
  value: unknown,
  entity?: string,
): string[];
export function validateFields(
  fields: { field: string; value: unknown }[],
  entity?: string,
): Record<string, string[]>;
export function registerValidator(
  field: string,
  fn: (v: unknown) => string[],
  entity?: string,
): void;
```

Resolution order: entity+field specific → generic → no validator (empty).
Returns an **array of i18n keys** (empty = valid). Route handlers return
`{ code: "VALIDATION", errors: string[] }` on non-empty.

| Field          | Rules                                      | i18n keys                                   |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| `email`        | Required, regex format                     | `validation.email.required`, `.invalid`     |
| `phone`        | Optional; if provided, 10–15 digits        | `validation.phone.invalid`                  |
| `password`     | Required, min 8 chars                      | `validation.password.required`, `.tooShort` |
| `name`         | Required, non-empty after trim             | `validation.name.required`                  |
| `slug`         | Required, lowercase alphanumeric + hyphens | `validation.slug.required`, `.invalid`      |
| `url`          | Optional; must be parseable                | `validation.url.invalid`                    |
| `currencyCode` | 3 uppercase letters                        | `validation.currencyCode.invalid`           |
| `cnpj`         | Required, 14 digits, valid check digits    | `validation.cnpj.required`, `.invalid`      |

Validation i18n keys live in `src/i18n/{locale}/validation.json`.

`phone` treats empty/null/undefined as valid (optional). Other validators that
start with a required check say so explicitly.

#### 12.7 CORS (`server/utils/cors.ts`)

Enforces `api_token.frontendDomains` for `frontendUse = true` tokens (only for
`actorType="api_token"` otherwise it should be ignored).

1. Missing/empty `Origin` header → rejected (frontend tokens must come from a
   browser).
2. Origin not matching any entry in `frontendDomains` (exact scheme + host
   - port) → 403 with `common.error.cors`.
3. On success, response is decorated with
   `Access-Control-Allow-Origin: <origin>`,
   `Access-Control-Allow-Credentials: true`, and the appropriate
   `Allow-Methods`/`Allow-Headers`. Preflight (`OPTIONS`) bypasses `withAuth`
   but runs `cors.ts` — the frontend passes the token in a custom header during
   preflight so the gateway can resolve it.

Tokens with `frontendUse = false` are strictly server-to-server: any request
carrying a browser `Origin` for such a token is rejected outright.

#### 12.8 Token revocation (`server/utils/token-revocation.ts`)

```typescript
export async function revokeJti(jti: string, reason: string): Promise<void>;
export async function isJtiRevoked(jti: string): Promise<boolean>;
```

Keyed by `jti`. User-session JWTs use a small `token_revocation` table where
rows TTL to the original `exp` — stays bounded automatically. Never-expiring
tokens (`api_token.neverExpires=true`) use `api_token.revokedAt` directly (not
the TTL table).

`withAuth` performs revocation checks on **every** authenticated request
(cache + single-row lookup keeps the overhead negligible relative to JWT
verification).

#### 12.9 Module Registry (`server/module-registry.ts`)

Central registration API that subsystems and frameworks call to register their
handlers, jobs, and components. The core never imports subsystem code — all
wiring goes through `register*` functions called at boot.

```typescript
// Event handlers — one name per handler, used as both event name and
// function key. Publishers call `publish(name, payload)`; workers resolve
// the function by the same name.
registerHandler(name: string, fn: HandlerFn): void;
getHandler(name: string): HandlerFn | undefined;
getAllHandlers(): string[];

// Jobs — maps job name → start function for non-event-queue recurring jobs
registerJob(name: string, startFn: () => void): void;
getAllJobs(): Record<string, () => void>;

// i18n — system-specific translation files
registerSystemI18n(systemSlug: string, locale: string, data: TranslationMap): void;

// Communication templates — static per-channel TemplateFunctions, resolved at
// send time by path under `server/utils/communication/templates/<channel>/`.
registerTemplate(channel: string, path: string, fn: TemplateFunction): void;
// Dynamic template builders — called once per channel iteration (§15.2).
registerTemplateBuilder(name: string, fn: TemplateBuilder): void;
// Register a channel name so the dispatcher can route to its handler.
// The handler name is always `send_<channel>` by convention; the registry
// only tracks which channels exist.
registerChannel(channel: string): void;
hasChannel(channel: string): boolean;

// Cache — centralized cache registry (§12.11)
registerCache<T>(slug: string, name: string, loader: () => Promise<T>): void;
getCache<T>(slug: string, name: string): Promise<T>;
updateCache<T>(slug: string, name: string): Promise<T>;
clearCache(slug: string, name: string): void;
clearAllCacheForSlug(slug: string): void;

// Lifecycle hooks — subsystems react to core events without core importing them
registerLifecycleHook(event: LifecycleEvent, hook: (payload) => Promise<void>): void;
runLifecycleHooks(event: LifecycleEvent, payload: Record<string, unknown>): Promise<void>;
// Lifecycle events: "lead:delete", "lead:verify"

// Re-exports from existing registries for one-import convenience:
registerComponent, registerHomePage
```

**Boot sequence** (in `server/jobs/index.ts`):

1. `registerCore()` — `server/core-register.ts` registers core caches
   (`"core"::"data"`, `"core"::"front-data"`, `"core"::"jwt-secret"`), core
   event handlers, and core jobs (recurring-billing, token-cleanup).
2. `registerAllSystems()` — `systems/index.ts` calls each subsystem's
   `register()` function, which may register system-specific caches.
3. `registerAllFrameworks()` — `frameworks/index.ts` calls each framework's
   `register()` function, which may register framework-specific caches.
4. `startEventQueue()` — resolves handler functions from the registry, starts
   workers.
5. Iterate `getAllJobs()` — starts all registered recurring jobs.

**Systems vs frameworks.** Systems are runtime tenants (e.g. grex-id) with code
under `server/db/queries/systems/`, `src/components/systems/`, etc. Frameworks
are design-time code bundles under `frameworks/<name>/`. Both use the same
module-registry API, but register through separate entry points:
`systems/index.ts` and `frameworks/index.ts` respectively.

Subsystems register via `systems/[slug]/register.ts`, exporting a single
`register()` function. Frameworks follow the same pattern at
`frameworks/[name]/register.ts`.

#### 12.10 Guard functions (`server/utils/guards.ts`)

Reusable internal functions for plan-limit enforcement. Used by middleware but
also callable from queries, event handlers, and jobs. All plan, voucher, and
subscription data is read from the Core.ts cache — these functions never query
the DB directly. Dynamic data (entity counts, actor counts) still requires DB
queries performed by the caller.

```typescript
// Resolve the effective entity limit from cached plan + voucher.
// Returns { limit: number | null, planLimit: number | null, voucherModifier: number }
async function resolveEntityLimit(params: {
  companyId: string;
  systemId: string;
  entityName: string;
}): Promise<EntityLimitResult>;

// Check subscription status + plan permissions from cache.
// Returns { granted: boolean, denyCode?: "NO_SUBSCRIPTION" | "SUBSCRIPTION_EXPIRED" | "PLAN_LIMIT" }
async function checkPlanAccess(
  tenant: Tenant,
  featureNames: string[],
): Promise<PlanAccessResult>;

// Compute rate limit from cached plan + voucher.
// Returns { globalLimit: number, planRateLimit: number, voucherModifier: number }
async function resolveRateLimitConfig(params: {
  companyId: string;
  systemId: string;
}): Promise<RateLimitConfigResult>;
```

```typescript
// Resolve the effective file cache limit from cached plan + voucher.
// Returns { maxBytes, planLimit, voucherModifier }
async function resolveFileCacheLimit(params: {
  companyId: string;
  systemId: string;
}): Promise<FileCacheLimitResult>;
```

```typescript
// Resolve the effective max concurrent downloads from cached plan + voucher.
// Returns { max, planLimit, voucherModifier }
async function resolveMaxConcurrentDownloads(params: {
  companyId: string;
  systemId: string;
}): Promise<TransferLimitResult>;

// Resolve the effective max concurrent uploads from cached plan + voucher.
// Returns { max, planLimit, voucherModifier }
async function resolveMaxConcurrentUploads(params: {
  companyId: string;
  systemId: string;
}): Promise<TransferLimitResult>;

// Resolve the effective max download bandwidth (MB/s) from cached plan + voucher.
// Returns { maxMB, planLimit, voucherModifier }
async function resolveMaxDownloadBandwidth(params: {
  companyId: string;
  systemId: string;
}): Promise<TransferLimitResult>;

// Resolve the effective max upload bandwidth (MB/s) from cached plan + voucher.
// Returns { maxMB, planLimit, voucherModifier }
async function resolveMaxUploadBandwidth(params: {
  companyId: string;
  systemId: string;
}): Promise<TransferLimitResult>;

// Resolve the effective max operation count for a specific resourceKey from cached plan + voucher.
// Returns { max, planLimit, voucherModifier }. A value of 0 means no cap for this key.
async function resolveMaxOperationCount(params: {
  companyId: string;
  systemId: string;
  resourceKey: string;
}): Promise<TransferLimitResult>;

// Resolve all operation counts as a merged map (plan + voucher) for subscription init/renewal.
// Returns { "faceDetection": 100, "reportGeneration": 50, ... }
async function resolveAllOperationCounts(params: {
  companyId: string;
  systemId: string;
}): Promise<Record<string, number>>;
```

All `TransferLimitResult` fields:
`{ max: number, planLimit: number, voucherModifier: number }`. A `max` of `0`
means unlimited. Voucher modifiers are signed integers — negative decreases the
limit, positive increases it. The effective value is computed as
`max(0, planLimit + voucherModifier)`.

**`resolveMaxOperationCount`** follows the same per-key pattern as
`resolveEntityLimit`: looks up `plan.maxOperationCount?.[resourceKey]` and
`voucher.maxOperationCountModifier?.[resourceKey]`. Missing keys = no cap for
that resourceKey.

**`resolveAllOperationCounts`** merges all keys from plan's `maxOperationCount`
with the voucher's `maxOperationCountModifier`, producing a single map. Used for
subscription initialization and renewal.

#### 12.11 Centralized Cache (`server/utils/cache.ts`)

A unified cache registry that replaces ad-hoc singleton caching. Every
server-side cache — Core data, FrontCore data, subscriptions, JWT secrets,
system-specific lookups — MUST be registered through this module. No module
shall maintain its own in-memory `Map` + `loaded` flag + `loadPromise` pattern.

**Registration at boot.** Caches are registered during the boot sequence (§12.9)
alongside handlers, jobs, and templates. Core caches are registered in
`server/core-register.ts`; system and framework caches are registered in their
respective `register()` functions. Registration must happen **before** any
`getCache` call — calling `getCache` on an unregistered name throws.

**API:**

```typescript
// Register a cache entry. Slug scopes the namespace; name identifies the cache.
// The loader is an async function that fetches data from the DB (or composes
// from other caches). Calling registerCache again for the same (slug, name)
// replaces the loader but preserves the cached value until next getCache/updateCache.
registerCache<T>(slug: string, name: string, loader: () => Promise<T>): void;

// Returns the cached value. On first call, executes the loader (single-flight:
// concurrent callers share the same in-flight promise). Subsequent calls return
// the cached value instantly.
getCache<T>(slug: string, name: string): Promise<T>;

// Re-executes the loader and replaces the cached value. Used by route handlers
// and event handlers after mutations (e.g. Core.reload() calls updateCache
// internally).
updateCache<T>(slug: string, name: string): Promise<T>;

// Returns the cached value synchronously if loaded, or undefined otherwise.
// Use sparingly — prefer the async getCache.
getCacheIfLoaded<T>(slug: string, name: string): T | undefined;

// Clears a single cache entry (value + loaded flag), forcing a fresh load on
// next getCache.
clearCache(slug: string, name: string): void;

// Clears all cache entries for the given slug namespace.
clearAllCacheForSlug(slug: string): void;
```

**Rules:**

1. **Every cache must be registered.** No ad-hoc `Map` + `loaded` boolean +
   `loadPromise` patterns. The cache module handles single-flight loading,
   invalidation, and eviction.
2. **Slug identifies the namespace.** The core platform (Core settings,
   FrontCore settings, JWT secrets, subscriptions) uses `"core"`. Systems use
   their slug (e.g. `"grex-id"`). Frameworks use their namespace. This prevents
   name collisions — the cache name distinguishes entries within the same
   namespace (e.g. `"data"`, `"front-data"`, `"jwt-secret"`).
3. **Loaders are pure data fetchers.** They must not mutate state, dispatch
   events, or depend on request context. They may compose from other caches
   (e.g. the JWT secret cache reads from the Core data cache via
   `Core.getSetting`).
4. **Invalidation is explicit.** After any mutation that affects cached data,
   the route handler or event handler calls `updateCache` (or the owning
   singleton's `reload()` method which delegates to `updateCache` internally).
   There is no TTL-based expiry — caches live until explicitly refreshed or
   cleared.
5. **Derived caches must be cleared when their source changes.** When
   `Core.reload()` refreshes the core data cache, it also clears the
   `"jwt-secret"` cache since that value is derived from settings. Any new
   derived cache must follow the same pattern.
6. **Dynamic caches (subscriptions).** Per-tenant caches like subscriptions are
   registered on first access and tracked in a `Set`. Bulk eviction
   (`evictAllSubscriptions`) iterates the tracked keys and calls `clearCache` on
   each. This avoids needing to know all possible keys up front.
7. **No `require()` or Node APIs.** The cache module uses standard JS only
   (§1.1.1), since it may be imported by isomorphic code.

**Core caches registered at boot:**

| Slug     | Name                           | Loader                        | Invalidated by                                      |
| -------- | ------------------------------ | ----------------------------- | --------------------------------------------------- |
| `"core"` | `"data"`                       | `loadCoreData()` (§10.1)      | `Core.reload()` after any core entity mutation      |
| `"core"` | `"front-data"`                 | `loadFrontCoreData()` (§10.2) | `FrontCore.reload()` after front-setting writes     |
| `"core"` | `"jwt-secret"`                 | `loadJwtSecret()` (§token)    | `Core.reload()` (derived from settings)             |
| `"core"` | `"sub:<companyId>:<systemId>"` | `loadSubscription()`          | `Core.reloadSubscription()` after billing mutations |

Systems and frameworks register their own caches following the same pattern.

#### 12.12 File Cache — Sliding-Window Size-Aware LFU (`server/utils/file-cache.ts`)

A per-tenant in-memory file cache that stores file content as `Uint8Array` and
avoids SurrealFS reads on cache hits. **Separate from the config cache
registry** (§12.11) — the file cache is a standalone singleton
(`FileCacheManager`) because it stores binary content, not configuration data.

**Algorithm: Sliding-Window Size-Aware LFU.** Each file's priority is determined
by its hit count within a configurable time window — not by cumulative or
churn-decayed counters. This makes the cache **adaptive**: files that were
popular an hour ago but haven't been accessed recently naturally decay, while
newly popular files rise immediately.

**Two parameters:**

1. `maxSize` — total cache capacity in bytes (per tenant).
2. `hitWindowMs` — sliding window duration in milliseconds. Read from
   `Core.getSetting("cache.file.hitWindowHours")` (default 1 hour). The download
   route resolves this alongside `maxSize` and passes it to `access()`.

**State per tenant** (keyed by `"companyId:systemSlug"`):

- `files: Map<string, { data: Uint8Array; size: number; mimeType: string; accesses: number[]; lastAccess: number }>`
- `usedSize: number`

`accesses` is an array of `Date.now()` timestamps — one per hit. Old timestamps
are pruned on each access and on eviction scoring.

**Global state:**

- `accessCounter: number` — monotonic counter for LRU tiebreaking

**Priority score:** `score = hitsInWindow / size`. Only accesses within
`hitWindowMs` count toward `hitsInWindow`. Larger files need more recent hits to
justify their space.

**On access(`tenantKey`, `fileId`, `fileSize`, `maxSize`, `data?`,
`hitWindowMs?`, `mimeType?`):**

1. `accessCounter += 1`
2. If file is already cached: push `Date.now()` into `accesses`, prune
   timestamps older than `now - hitWindowMs`, `lastAccess = accessCounter` →
   return `{ hit: true, data: entry.data, mimeType: entry.mimeType }`
3. If `fileSize > maxSize`: return `{ hit: false, noCache: true }` — file too
   large to ever cache
4. While `usedSize + fileSize > maxSize`: evict the cached file with the lowest
   `score` (ties broken by oldest `lastAccess`). Scoring prunes each candidate's
   `accesses` array before computing `hitsInWindow`. Files with zero hits in
   window are evicted first.
5. If `data` is provided: insert new entry
   `{ data, size: fileSize, mimeType, accesses: [Date.now()], lastAccess: accessCounter }`
6. `usedSize += fileSize`
7. Return `{ hit: false, noCache: false }`

**Adaptive behavior.** Because scoring only counts hits within the window, the
cache automatically forgets old popularity. A file accessed 100 times yesterday
but zero times in the last hour scores 0 — it becomes the first eviction
candidate. No explicit aging step is needed.

**Max-size resolution:**

- Tenant (company + system): `resolveFileCacheLimit()` (plan's
  `fileCacheLimitBytes` + voucher's `fileCacheLimitModifier`)
- Core / anonymous: `Core.getSetting("cache.core.size")` (seeded at `"20"`,
  interpreted as megabytes → multiplied by 1048576)

**Hit-window resolution:**

- `Core.getSetting("cache.file.hitWindowHours")` (seeded at `"1"`)
- Converted to milliseconds by the caller before passing to `access()`

**Integration point:** the download route (`GET /api/files/download`) checks the
cache before reading from SurrealFS. On cache miss, it reads from SurrealFS and
stores the content in the cache. The upload route calls `evict()` on replacement
(§13.2 step 7). Anonymous requests use the core cache (tenant key `"core"`, same
as superuser without a matching system).

**File deletions** should call `clearTenant()` for the affected tenant to
prevent stale data.

**Usage reporting:** `FileCacheManager.getStats(tenantKey, maxSize)` returns
`{ usedBytes, maxBytes, fileCount }` for the Usage API and UsagePage.

**Contract:**

```typescript
export interface FileCacheResult {
  hit: boolean;
  noCache: boolean; // true when file exceeds maxSize
  data?: Uint8Array;
  mimeType?: string; // stored on insert, returned on hit — avoids DB metadata lookup
}

export interface FileCacheStats {
  usedBytes: number;
  maxBytes: number;
  fileCount: number;
}
```

#### 12.13 Communication guard (`server/utils/verification-guard.ts`)

Unified helper that replaces all per-route cooldown/expiry logic. Every route
that sends a verification email/SMS MUST call `communicationGuard()` instead of
manually checking cooldowns or creating `verification_request` rows.

**Settings** (dynamic, seeded via `002_default_settings.ts`):

| Key                                 | Default | Purpose                                                         |
| ----------------------------------- | ------- | --------------------------------------------------------------- |
| `auth.communication.expiry.minutes` | `"15"`  | Unified expiry for all verification/communication tokens        |
| `auth.communication.maxCount`       | `"5"`   | Max verification sends per (owner, actionKey) in rolling window |
| `auth.communication.windowHours`    | `"1"`   | Rolling window in hours for the rate limit                      |

**Rules enforced in a single batched `db.query()` (§7.2):**

1. **Previous-not-expired:** If an unused, non-expired `verification_request`
   exists for the same `(ownerId, actionKey)`, the new request is blocked with
   reason `previousNotExpired`.
2. **Rate limit:** If the owner has >= `maxCount` requests with this `actionKey`
   within the rolling window (`windowHours`), the request is blocked with reason
   `rateLimited`.
3. If both checks pass, the `verification_request` row is created atomically in
   the same batched query with the supplied tenant context fields (`companyId`,
   `systemId`, `systemSlug`, `actorId`, `actorType`) captured alongside
   `payload`.

**Contract:**

```typescript
export interface CommunicationGuardResult {
  allowed: boolean;
  reason?: "previousNotExpired" | "rateLimited";
  token?: string;
  expiresAt?: Date;
}

export async function communicationGuard(params: {
  ownerId: string; // user:… or lead:…
  actionKey: string; // i18n key, e.g. "auth.action.register"
  payload?: Record<string, unknown>; // non-sensitive only
  tenant?: { // tenant context captured in the
    companyId?: string; //   verification_request row
    systemId?: string;
    systemSlug?: string;
    actorId?: string;
    actorType?:
      | "user"
      | "lead"
      | "api_token"
      | "connected_app"
      | "anonymous"
      | "system";
  };
}): Promise<CommunicationGuardResult>;
```

**Route integration.** Routes that protect against user enumeration
(forgot-password, account-recovery) return generic success when `!allowed`.
Public routes (leads) and authenticated routes (entity-channels resend) return
429 with the appropriate i18n key (`validation.verification.previousNotExpired`
or `validation.verification.rateLimited`).

#### 12.14 Server-only guard (`server/utils/server-only.ts`)

Every file under `server/` that must never be imported by frontend code calls
the shared `assertServerOnly(fileName)` helper at the top of the module, right
after its imports. The helper throws
`` `${fileName} must not be imported in client-side code.` `` when `window` is
defined, so bundler missteps that would pull server code into the browser fail
loudly at import time.

```typescript
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("Core");
```

**Rules:**

1. Every module under `server/` (utilities, queries, middleware, event-queue
   handlers, jobs, connection, runners) MUST call `assertServerOnly` as the
   first statement after its import block. No raw
   `typeof window !== "undefined"` checks anywhere else — the helper is the
   single source of truth.
2. Pass a short, unambiguous identifier as the `fileName` argument (e.g.
   `"Core"`, `"tenant.ts"`, `"server/utils/fs.ts"`,
   `"process-payment handler"`). The message suffix
   (`must not be imported in client-side code.`) is standard and supplied by the
   helper.
3. The guard itself lives in `server/utils/server-only.ts` and is the only file
   in the project that references `typeof window` for this purpose.

#### 12.15 Field encryption wrapper (`server/utils/crypto.ts`)

Single shared AES-256-GCM helper for every "encryption at rest" path required by
§7.1.1. Every sensitive field (currently: `user.twoFactorSecret`,
`user.pendingTwoFactorSecret` — others to follow) uses this wrapper on every
write and every read.

**Algorithm:**

- **AES-256-GCM** via the Web Crypto API (`crypto.subtle` — serverless
  runtime-compatible, §1.1.1).
- **12-byte IV**, generated fresh per encryption call with
  `crypto.getRandomValues`.
- **16-byte authentication tag**, produced by the GCM construction and included
  in the ciphertext envelope.
- **32-byte (256-bit) key**, loaded from the `auth.encryption.key` Core setting.
  The setting stores the key as base64; the wrapper decodes it once at boot into
  a `CryptoKey`. The key is NOT editable from the superuser panel — rotation
  requires a deploy and a re-encryption migration.

**Wire format.** Every ciphertext is a single base64 string shaped as
`<iv_b64>:<ciphertext_with_tag_b64>`. The tag is appended to the ciphertext by
GCM (16-byte trailer), so a single base64 decode recovers both. The DB column
stays `TYPE option<string>`.

**Contract:**

```typescript
/**
 * Encrypt a plaintext string. Returns a base64 envelope safe to store in a
 * `TYPE option<string>` SurrealDB column. Uses a fresh 12-byte IV per call.
 */
export async function encryptField(plaintext: string): Promise<string>;

/**
 * Decrypt a base64 envelope produced by `encryptField`. Throws on tag
 * mismatch (tampering, wrong key) — callers treat the throw as a
 * cryptographic failure, not a missing value.
 */
export async function decryptField(envelope: string): Promise<string>;

/**
 * Convenience: returns `undefined` when `envelope` is `undefined | null | ""`,
 * otherwise delegates to `decryptField`. Use at read-path boundaries where
 * the optional column may be absent.
 */
export async function decryptFieldOptional(
  envelope: string | null | undefined,
): Promise<string | undefined>;
```

**Rules:**

1. **All writes** to an encrypted field go through `encryptField()`; the DB
   receives only the envelope. Never `UPDATE … SET field = $plaintext`.
2. **All reads** that need the plaintext go through `decryptField()` /
   `decryptFieldOptional()`. Never expose the envelope to the frontend; it has
   no meaning outside the server.
3. **The plaintext never leaves request scope.** No logging, no caching, no copy
   into another column, no write into `verification_request.payload` (§15.1 rule
   5).
4. **`auth.encryption.key` boot check.** The wrapper verifies, at first use,
   that the setting is a valid 32-byte base64 key. A missing or malformed key
   throws a loud error so the process fails closed rather than silently storing
   ciphertext decryptable with a dev-only fallback.
5. **Key rotation** is an explicit migration: decrypt every encrypted field with
   the old key, re-encrypt with the new key, update `auth.encryption.key`. The
   wrapper does not support envelope versioning beyond this — the assumption is
   that rotations are infrequent and done as coordinated deploys.
6. Only `server/utils/crypto.ts` calls `crypto.subtle.encrypt` /
   `crypto.subtle.decrypt` for at-rest data. Other callsites use the public
   helpers.

**Seeded defaults.** `002_default_settings.ts` seeds `auth.encryption.key` with
a clearly dev-only placeholder. Production deployments MUST overwrite this via
their secret-management pipeline before any sensitive write happens. The seed
description warns explicitly.

### 13. File Storage

Uses `@hviana/surreal-fs` exclusively. All file data **and** metadata are stored
within surreal-fs — no separate SQL tables.

#### 13.1 Path pattern

```
path = [companyId, systemSlug, userId, ...category, fileUuid, fileName]
```

All elements are **deterministic** — the download route splits the path array to
extract `companyId` (index 0), `systemSlug` (index 1), and `userId` (index 2)
for control mechanisms (cache context, access checks, rate limiting).

`category` is a `string[]` spread between `userId` and `fileUuid` (e.g.
`["documents","invoices"]`), enabling directory-like browsing via
`fs.readDir()`.

**`fileUuid` is frontend-generated.** The frontend creates a new
`crypto.randomUUID()` for new files and reuses the existing UUID when replacing
a file. This allows atomic replacement via surreal-fs — sending the same path
overwrites the file contents while keeping the same URI. The route never
generates UUIDs.

#### 13.2 Upload route (`POST /api/files/upload`)

FormData: `file` (stream), `systemSlug`, `category` (JSON string array),
`fileUuid`, optional `description`. The `fileUuid` is generated by the frontend
— new file → new UUID; replace existing → same UUID (see §13.1).

**Single route, single flow.** Authentication state determines the tenant
context (§9), which in turn determines the path elements `companyId` and
`userId`. There is no separate "authenticated mode" vs "unauthenticated mode" —
the `control` callback enforces all policy differences.

**Path construction follows tenant conventions (§9):**

`companyId` is `ctx.tenant.companyId` and `userId` is `ctx.claims.actorId` —
directly from the tenant/claims, no defaults, no special cases. Per §9.2:
unauthenticated requests receive `companyId = "0"` and `actorId = "0"`;
superusers without a tenant receive `companyId = "0"` and their real `actorId`.
These values flow into the path as-is.

`systemSlug` comes from FormData in all cases — the frontend always knows the
slug.

**Route steps:**

1. `withAuth` populates `ctx.tenant` + `ctx.claims`. Unauthenticated requests
   receive the synthesized anonymous Tenant (§9.2).
2. Validate FormData: `file`, `systemSlug`, `category`, `fileUuid` required.
3. Resolve `companyId` and `userId` from the tenant context —
   `companyId = ctx.tenant.companyId`, `userId = ctx.claims?.actorId ?? "0"`.
   Per §11, `ctx.claims` is `undefined` for unauthenticated requests; the
   `?? "0"` fallback ensures `userId` is always a string.
4. Construct path per §13.1:
   `path = [companyId, systemSlug, userId, ...category, fileUuid, fileName]`.
5. Stream the file directly from FormData (`file.stream()`) — never buffer into
   memory.
6. Call `fs.save({ path, content: stream, metadata, control })` where metadata
   includes `companyId`, `systemSlug`, `userId`, `category`, `fileName`,
   `fileUuid`, `mimeType`, optional `description`.

**`control` callback** — all validation, rate limiting, size limits, and
extension checks are enforced inside `control` (not in the route handler). This
leverages surreal-fs's built-in concurrency maps and throttling. The callback
receives `(path, concurrencyMap)` and returns a `SaveControlResult`. Effective
limits are resolved from the plan + voucher via guard functions (§12.10) and
Core settings (§10.1.4):

```typescript
control: ((_path, concurrencyMap): SaveControlResult => {
  // Tenant-aware resolution: guard functions for tenants, Core settings fallback
  const uploadLimits = resolveMaxConcurrentUploads({ companyId, systemId });
  const bwLimits = resolveMaxUploadBandwidth({ companyId, systemId });

  // Concurrency: guard result (0 = unlimited) → Core setting fallback → unlimited
  const userUploads = concurrencyMap[userId] ?? 0;
  const maxConcurrent = uploadLimits.max || Number(Core.getSetting('transfer.default.maxConcurrentUploads')) || 0;
  if (maxConcurrent > 0 && userUploads >= maxConcurrent) {
    return { accessAllowed: false, concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`] };
  }

  // Bandwidth: divide among active uploads for this tenant
  const maxBWMB = bwLimits.maxMB || Number(Core.getSetting('transfer.default.maxUploadBandwidthMB')) || 0;
  const tenantUploads = concurrencyMap[`${companyId}/${systemSlug}`] ?? 1;
  const kbytesPerSecond = maxBWMB > 0
    ? Math.floor((maxBWMB * 1024) / tenantUploads)
    : 16384; // fallback when unlimited

  return {
    accessAllowed: true,
    kbytesPerSecond,
    concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
    maxFileSizeBytes: 52428800, // 50 MB scaffold
    allowedExtensions: [],
  };
}));
```

`companyId` and `systemSlug` are closure variables from the tenant context and
FormData — not re-extracted from the `path` argument.

7. **Cache invalidation on replacement.** If the file already existed (same path
   = replacement), clear the cached entry for that URI so subsequent downloads
   fetch the fresh content. Uses the same cache context resolution as the
   download route (§13.3, §13.6).
8. Return `{ uri, fileUuid, fileName, sizeBytes, mimeType }`.

#### 13.3 Download route (`GET /api/files/download?uri=...`)

**Stream-first, cache-aware.** The route always streams to the client. Cache
hits bypass SurrealFS; cache misses stream from SurrealFS with optional
background caching (§13.6).

**No invented helpers.** This route uses only the surreal-fs API (`fs.read`,
`fs.URIComponentToPath`, `SurrealFS.readStream`) and the file cache
(`FileCacheManager.access`, `evict`). Never create MIME-type maps, manual chunk
iterators, or metadata lookup helpers — mimeType comes from upload metadata or
the cached entry.

**Path extraction for control (not JWT).** The URI encodes the full path per
§13.1: `uri = "{companyId}/{systemSlug}/..."`. The route decodes the URI into a
path array and extracts `companyId` (index 0) and `systemSlug` (index 1) for
cache context resolution and access control — independently of authentication
state.

**Route steps:**

1. Decode `uri` into `path` array via `fs.URIComponentToPath(uri)`.
2. Extract `companyId = path[0]`, `systemSlug = path[1]` for cache context
   (§13.6).
3. **Cache HIT:** return `Response` from cached `Uint8Array` — skip SurrealFS
   entirely.
4. **Cache MISS:** call `fs.read({ path, control })` — returns a `File` with a
   lazy `ReadableStream` for the content.

**`control` callback** — rate limiting and concurrency via surreal-fs. Effective
limits are resolved from the plan + voucher via guard functions (§12.10) and
Core settings (§10.1.4):

```typescript
control: ((_path, concurrencyMap): ReadControlResult => {
  // Tenant-aware resolution: guard functions for tenants, Core settings fallback
  const dlLimits = resolveMaxConcurrentDownloads({ companyId, systemId });
  const bwLimits = resolveMaxDownloadBandwidth({ companyId, systemId });

  // Concurrency: guard result (0 = unlimited) → Core setting fallback → unlimited
  const userDownloads = concurrencyMap[userId] ?? 0;
  const maxConcurrent = dlLimits.max ||
    Number(Core.getSetting("transfer.default.maxConcurrentDownloads")) || 0;
  if (maxConcurrent > 0 && userDownloads >= maxConcurrent) {
    return {
      accessAllowed: false,
      concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
    };
  }

  // Bandwidth: divide among active downloads for this tenant
  const maxBWMB = bwLimits.maxMB ||
    Number(Core.getSetting("transfer.default.maxDownloadBandwidthMB")) || 0;
  const tenantDownloads = concurrencyMap[`${companyId}/${systemSlug}`] ?? 1;
  const kbytesPerSecond = maxBWMB > 0
    ? Math.floor((maxBWMB * 1024) / tenantDownloads)
    : 16384;

  return {
    accessAllowed: true,
    kbytesPerSecond,
    concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
  };
});
```

`companyId`, `systemSlug`, and `userId` are extracted from the path array, not
from the JWT. Anonymous requests and superusers without a tenant context resolve
limits from Core settings (guard functions return 0 for unmatched tenants, which
triggers the Core setting fallback).

5. Resolve `fileName` from `file.metadata.fileName` and `mimeType` from
   `file.metadata.mimeType` (stored during upload, §13.2 step 6). Fallback: last
   path segment + `application/octet-stream`. **Never invent MIME-type maps or
   helper functions** — the mimeType is always available from metadata or from
   the cache hit's stored `mimeType` field (§12.12).
6. Stream response with `Content-Type`, `Content-Disposition`, `Content-Length`
   headers — the client receives bytes as soon as SurrealFS provides them.
7. **Background cache insertion** (non-blocking, deduplicated): tee the stream —
   one branch serves the client, the other is consumed via
   `SurrealFS.readStream(cacheStream)` into a `Uint8Array` and inserted into the
   file cache. Client never waits. **Never manually iterate chunks** — always
   use `SurrealFS.readStream()` for stream-to-buffer conversion.
   **Deduplication:** a set of URIs with in-flight insertions is tracked. If a
   second request arrives for the same URI while an insertion is already in
   progress, it streams directly without tee — no double buffering. The set
   entry is removed when the insertion completes (success or failure).

#### 13.4 Public API routes (no middleware pipeline)

Routes under `/api/public/*` require no authentication and expose only
non-sensitive, read-only data. Exception: `POST /api/public/webhook/payment`
accepts writes from payment providers (§22.9).

- **`GET /api/public/system`** — Query: `slug=<slug>` OR `default=true`
  (resolves from `app.defaultSystem`). Response:
  `{ success: true, data: { name, slug, logoUri, defaultLocale?, termsOfService? } | null }`.
  No rate limiting by default (static-like).
- **`GET /api/public/front-core`** — returns the full `front_setting` table as a
  key/value map. Used by FrontCore in the browser (§10.2).
- **`POST /api/leads/public`** — see §23.2.
- **`POST /api/public/webhook/payment`** — async payment webhook scaffold
  (§22.9). Generic JSON body; provider-specific validation is handled by the
  adapter layer. Publishes `payment_async_completed` event.

#### 13.5 File metadata

Managed entirely by `@hviana/surreal-fs` (`metadata` on `fs.save()`). No
separate `file_metadata` SQL table. Isomorphic contract shape:

```typescript
export interface FileMetadata {
  id: string;
  companyId: string;
  systemSlug: string;
  userId: string;
  category: string[];
  fileName: string;
  fileUuid: string;
  uri: string;
  sizeBytes: number;
  mimeType: string;
  description?: string;
  createdAt: string;
}
```

#### 13.6 File cache integration

The download route (§13.3) integrates with the file cache (§12.12). Cache logic
is described in §13.3 steps 3, 7 — this section defines the cache context
resolution only.

**Cache context resolution** — called by both the download route (§13.3) and the
upload route (§13.2 step 7) after extracting `companyId` and `systemSlug` from
the URI path. **This resolution is identical for all requests — authenticated,
anonymous, and superuser alike.** There is no auth-gated branch in cache context
resolution.

1. Look up `systemSlug` in the Core cache. If a matching system exists, resolve
   the effective `maxSize` via `resolveFileCacheLimit()` (plan's
   `fileCacheLimitBytes` + voucher's `fileCacheLimitModifier`). Tenant key:
   `"{companyId}:{systemSlug}"`.
2. **Core quota fallback:** if `systemSlug` does not match any system, or the
   resolved `maxBytes` from `resolveFileCacheLimit()` is 0, the file counts
   towards the core's quota. `maxSize` comes from
   `Core.getSetting("cache.core.size")` (megabytes, seeded at `"20"`) converted
   to bytes. Tenant key: `"core"`.
3. If the resolved `maxSize` is 0, caching is disabled for that context.

**Rules:**

- All requests use the cache — anonymous requests use the core cache (tenant key
  `"core"`), same as any unmatched system.
- Upload replacements call `evict()` on the resolved cache context (§13.2 step
  7) — always, regardless of authentication.
- File deletions via DataDeletion (§20.6) call `clearTenant()` for the affected
  tenant.

#### 13.7 File Access Control

Category-path-based access rules stored in the `file_access` table. Each rule
defines a `categoryPattern` (glob-like with `/` separators and `*` wildcards)
and separate download/upload sections with independent tenant isolation toggles
and permission lists. The upload section additionally carries `maxFileSizeMB`
(optional float, e.g. `0.5` = 512 KB) and `allowedExtensions` (array of strings
without dots, e.g. `["jpg","png"]`; empty = all extensions allowed).

**Pattern compilation.** `file-access-cache.ts` loads all rules at boot and
compiles each `categoryPattern` into a `RegExp` (`*` → `[^/]+`). Cached via the
centralized registry (`"core"::"file-access"`).

**Tenant isolation (per download/upload section).** Three independent toggles:

| Toggle           | Check                                    |
| ---------------- | ---------------------------------------- |
| `isolateSystem`  | `tenant.systemSlug` must match `path[1]` |
| `isolateCompany` | `tenant.companyId` must match `path[0]`  |
| `isolateUser`    | `claims.actorId` must match `path[2]`    |

- All off → anonymous access (no authentication required).
- Any on → authentication required; all enabled checks must pass (AND).
- Superuser or `*` wildcard permission always passes.

**Permissions.** Non-empty array → actor must have at least one listed
permission. Empty array → no permission check beyond tenant isolation.

**Guard resolution** (`server/utils/file-access-guard.ts` → `checkFileAccess`):

1. Load cached rules. If none exist → allow (backward compatible).
2. For each rule, test compiled regex against `categoryPath.join("/")`.
3. For each matching rule, check the operation-specific section's tenant
   isolation and permissions.
4. If ANY matching rule allows →
   `{ allowed: true, maxFileSizeBytes?, allowedExtensions? }`.
5. If matching rules exist but none allow → `{ allowed: false }`.
6. If no matching rules exist → `{ allowed: true }`.

When `operation = "upload"` and access is allowed, the result additionally
includes `maxFileSizeBytes` (the smallest non-null `maxFileSizeMB` across all
matching rules, converted to bytes; absent when no rule specifies a limit) and
`allowedExtensions` (the intersection of all non-empty `allowedExtensions`
arrays from matching rules; empty/absent when no restrictions apply). This
ensures the most restrictive combination is enforced when multiple rules match.

**Upload route integration.** `POST /api/files/upload` calls `checkFileAccess`
with `operation: "upload"` before `fs.save()`. Returns 403 on denial. On
success, the route passes `maxFileSizeBytes` and `allowedExtensions` from the
guard result into the `control` callback.

**Download route integration.** `GET /api/files/download` accepts an optional
`?token=<jwt_or_api_token>` query parameter. When present, the route resolves
the token independently (JWT via `verifyTenantToken`, API token via
`hashToken` + `findTokenByHash`), then calls `checkFileAccess` with
`operation: "download"` using the resolved tenant context. Returns 403 on
denial. Without a `token` param, uses the middleware-provided `ctx.tenant`.

**Core admin.** `app/(core)/file-access/page.tsx` — superuser CRUD with search
by name. Form has shared name + category pattern fields, plus separate Download
and Upload sections each with isolation toggles and permissions
`MultiBadgeField`. The Upload section additionally has `maxFileSizeMB` (number
input, supports decimals) and `allowedExtensions`
(`MultiBadgeField mode:"custom"`).

**Default seeds** (`004_default_file_access.ts`):

| Name                                 | Pattern          | Download     | Upload                                               | Upload constraints                        |
| ------------------------------------ | ---------------- | ------------ | ---------------------------------------------------- | ----------------------------------------- |
| `core.fileAccess.names.companyLogos` | `/logos/`        | Anonymous    | user+company+system, `core.files.upload.logos`       | 5 MB, `["svg","png","jpg","jpeg","webp"]` |
| `core.fileAccess.names.userAvatars`  | `/avatars/`      | user+company | user+company+system, `core.files.upload.avatars`     | 2 MB, `["png","jpg","jpeg","webp"]`       |
| `core.fileAccess.names.leadAvatars`  | `/lead-avatars/` | Anonymous    | user+company+system, `core.files.upload.leadAvatars` | 2 MB, `["png","jpg","jpeg","webp"]`       |

**Cache invalidation.** Route handlers call `updateCache("core", "file-access")`
after mutations. `Core.reload()` also clears the file-access cache.

### 14. Event Queue

#### 14.1 Architecture

Two tables: `queue_event` (the published fact) and `delivery` (one per handler
per event). **Workers pull from `delivery`, never `queue_event`.**

#### 14.2 Publisher (`server/event-queue/publisher.ts`)

```typescript
async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date,
): Promise<string>; // returns event id
```

Steps: (1) insert `queue_event` with `availableAt ?? now()`; (2) look up
handlers for this event name in the registry; (3) for each handler, insert a
`delivery` with `status="pending"`, `availableAt` copied from the event,
`maxAttempts` from handler config.

#### 14.3 Registry (`server/event-queue/registry.ts`)

**One event ⇒ one handler, same name.** The registry is a `Set<string>` of
registered names; the event name and its handler function are looked up by the
same key. There is no seeded map — every handler is added at boot through the
single call:

```typescript
registerHandler(name: string, fn: HandlerFn): void;
getHandler(name: string): HandlerFn | undefined;
getAllHandlers(): string[];
```

Publishers call `publish(name, payload)` using the same name. Core registers
`send_communication`, `send_email`, `send_sms`, `process_payment`,
`auto_recharge`, and `resolve_async_payment` in `core-register.ts`.

`send_communication` is the **sole handler** external callers invoke for
communications (§15). It receives the §15.2 contract and publishes the
registered per-channel handler (`send_email`, `send_sms`, …) for the first
channel whose recipients resolve for the entity. Per-channel handlers are
reserved for the dispatcher; route and handler code calls
`publish("send_communication", …)` exclusively.

Systems and frameworks add handlers via `registerHandler()` (§12.9) at boot,
never by editing this file directly.

#### 14.4 Worker loop (`server/event-queue/worker.ts`)

Each worker receives a `WorkerConfig`:

```typescript
export interface WorkerConfig {
  handler: string;
  maxConcurrency: number;
  batchSize: number;
  leaseDurationMs: number;
  idleDelayMs: number;
  retryBackoffBaseMs: number;
  maxAttempts: number;
}
```

Pseudocode:

```
LOOP forever:
  freeSlots = maxConcurrency - activeCount
  IF freeSlots <= 0: WAIT short; CONTINUE
  claimBatch = MIN(freeSlots, batchSize)

  SELECT FROM delivery
    WHERE handler = $handler AND status = "pending"
      AND availableAt <= time::now()
      AND (leaseUntil IS NONE OR leaseUntil <= time::now())
    ORDER BY availableAt ASC LIMIT $claimBatch;

  FOR EACH candidate atomically:
    UPDATE delivery SET status = "processing", leaseUntil = now()+$leaseDuration,
                        workerId = $workerId, attempts = attempts + 1,
                        startedAt = now()
    WHERE id = $id AND status = "pending";

  IF none claimed: WAIT idleDelay; CONTINUE

  FOR EACH claimed (parallel, up to maxConcurrency):
    TRY:
      event = FETCH queue_event WHERE id = delivery.eventId
      EXECUTE handler(event.payload)
      UPDATE delivery SET status="done", leaseUntil=NONE,
                          finishedAt=now(), lastError=NONE
    CATCH error:
      IF attempts >= maxAttempts:
        UPDATE delivery SET status="dead", leaseUntil=NONE,
                            lastError=error.message, finishedAt=now()
      ELSE:
        backoff = retryBackoffBaseMs * 2^(attempts-1)
        UPDATE delivery SET status="pending", leaseUntil=NONE,
                            availableAt = now()+backoff, lastError=error.message
```

#### 14.5 Idempotency

Every handler must be idempotent. Check whether the action was already performed
(e.g. welcome email sent for this user). Use `delivery.id` or `event.id` as the
idempotency key when talking to external services.

#### 14.6 Lease recovery

If a worker crashes, its `processing` rows become claimable again once
`leaseUntil` expires (claim filter: `OR leaseUntil <= time::now()`).

### 15. Communication (Channel-agnostic)

All communication flows through a **single entry point** (`send_communication`)
that dispatches to per-channel handlers (`send_email`, `send_sms`, and any
subframework-registered channel). There is only one unified contract and only
**two visual template families** — one for _human confirmations_ (actions that
require a click to proceed) and one for _notifications_ (informational events).

#### 15.1 Universal communication contract

Every publisher of a communication — route handlers, event handlers, jobs,
subsystems, frameworks — publishes the **same** event shape:

```typescript
import type { TemplateBuilder } from "@/src/contracts/communication";

await publish("send_communication", {
  channels: string[],                        // allowed channels, ordered.
                                             // First viable channel wins.
                                             // Empty or omitted → Core setting
                                             //   auth.communication.defaultChannels
  senders?: string[],                        // override per-channel default senders
  recipients: string[],                      // raw recipient values OR
                                             // entity_channel-owning entity ids
                                             // (user:…, lead:…). When a
                                             // non-raw id is passed, the
                                             // dispatcher resolves channel
                                             // values via profile.channels
                                             // filtered by the current channel.
  template: string | TemplateBuilder,        // deterministic path, no channel prefix
                                             // (e.g. "human-confirmation"
                                             // resolves to
                                             // server/utils/communication/
                                             // templates/<channel>/human-confirmation.ts)
                                             // OR a dynamic TemplateBuilder.
  templateData: Record<string, unknown>,     // everything the template needs,
                                             // including tenant context
                                             // (systemSlug, companyId, systemId,
                                             //  actorId, actorType, actionKey,
                                             //  occurredAt, locale, …)
});
```

**Rules:**

1. **Never publish `send_email`/`send_sms` directly** — they are reserved for
   the dispatcher. All callers publish `send_communication`.
2. **`channels` is ordered.** The dispatcher iterates left-to-right; the first
   channel whose per-channel handler resolves recipients and renders the
   template successfully wins. Subsequent channels are **fallbacks**, only
   attempted when the preceding channel returns
   `{ delivered: false, reason: … }` (missing recipient, unknown type, template
   missing, provider error).
3. **Empty `channels` ⇒ Core setting `auth.communication.defaultChannels`.**
4. **Tenant context always travels in `templateData`.** No separate top-level
   field for `systemSlug`, `companyId`, `actorId`, etc. — templates read them
   directly from `templateData`.
5. **Sensitive data never goes into `templateData` or
   `verification_request.
   payload`.** No passwords, card numbers, raw tokens,
   secrets. Only i18n keys, display names, action identifiers, and non-sensitive
   context (occurredAt, companyName, systemName, actorName, resource keys, URLs,
   etc.). This is a companion to the broader §7.1.1 rule — sensitive data also
   never lands in any DB column as plaintext.

#### 15.2 `TemplateBuilder` — dynamic templates

Subframeworks and systems can generate templates at runtime instead of writing
one file per template path. A `TemplateBuilder` is called once per channel
iteration by the dispatcher.

```typescript
export interface TemplateResult {
  body: string;
  title?: string;
}

export type TemplateBuilder = (
  senders: string[],
  recipients: string[],
  templateData: Record<string, unknown>,
  channel: string,
) => Promise<TemplateResult>;
```

Register a builder with `registerTemplateBuilder(name, fn)`. Core registers its
two canonical builders (`human-confirmation`, `notification`) in
`core-register.ts` so every caller can reference them by name without a file
import. Frameworks and systems register their own builders inside their
`register()` function.

#### 15.3 Template path convention

Static per-channel templates live under
`server/utils/communication/templates/<channel>/<path>.ts`. The `template` field
passed to `send_communication` is always the **channel-less path**; the
dispatcher prepends `<channel>/` before resolving. This lets the same caller
target multiple channels without string gymnastics.

Examples:

| `template` field        | Channel | Resolved file                                                         |
| ----------------------- | ------- | --------------------------------------------------------------------- |
| `"human-confirmation"`  | `email` | `server/utils/communication/templates/email/human-confirmation.ts`    |
| `"human-confirmation"`  | `sms`   | `server/utils/communication/templates/sms/human-confirmation.ts`      |
| `"notification"`        | `email` | `server/utils/communication/templates/email/notification.ts`          |
| `foo-framework/invoice` | `email` | `server/utils/communication/templates/email/foo-framework/invoice.ts` |

For dynamic templates, the `TemplateBuilder` registered under the given name is
called instead.

#### 15.4 The two core templates

Core ships **exactly two** templates per channel. All Core actions and events
funnel through these builders — no bespoke templates remain.

##### 15.4.1 `human-confirmation` — action requires a click

Used whenever the system needs an explicit human confirmation to proceed: email
verification, password reset, recovery channel verification, lead-data update,
tenant invite, credential change. Backed by a `verification_request` row (§8)
that captures the action + tenant context.

**`templateData` fields** (all strings unless noted):

| Field              | Required | Description                                                             |
| ------------------ | -------- | ----------------------------------------------------------------------- |
| `actionKey`        | yes      | i18n key for the action name (e.g. `"auth.action.register"`)            |
| `confirmationLink` | yes      | HTTPS link to the confirmation endpoint                                 |
| `occurredAt`       | yes      | ISO-8601 timestamp of the action request                                |
| `actorName`        | no       | Display name of the acting user (absent for anonymous / system actions) |
| `companyName`      | no       | Tenant company name (absent for core / anonymous actions)               |
| `systemName`       | no       | Tenant system name (absent for core / anonymous actions)                |
| `expiryMinutes`    | no       | Minutes until the link expires (defaults to Core setting)               |

##### 15.4.2 `notification` — informational event

Used whenever the system needs to **inform** without requiring a human response:
payment outcomes, auto-recharge notices, credit alerts, operation-limit alerts,
pending/expired payments, subscription status changes, any framework event.

**`templateData` fields:**

| Field         | Required | Description                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| `eventKey`    | yes      | i18n key for the event name (e.g. `"billing.event.paymentSuccess"`)                    |
| `occurredAt`  | yes      | ISO-8601 timestamp of the event                                                        |
| `actorName`   | no       | Display name of the actor who triggered the event                                      |
| `companyName` | no       | Tenant company name                                                                    |
| `systemName`  | no       | Tenant system name                                                                     |
| `resources`   | no       | `string[]` — i18n keys identifying affected resources (e.g. plan names, resource keys) |
| `value`       | no       | `{ amount: number; currency: string }` — monetary value                                |
| `invoiceUrl`  | no       | Invoice link                                                                           |
| `ctaKey`      | no       | i18n key for an optional CTA button label                                              |
| `ctaUrl`      | no       | URL for the optional CTA button                                                        |

#### 15.5 Tenant-context conventions in `templateData`

Because the Tenant contract (§9) must handle anonymous, core-only, automatic,
and per-user contexts, callers follow these conventions when populating the
display fields for the two core templates:

| Context                                 | `actorName`            | `companyName`     | `systemName`      |
| --------------------------------------- | ---------------------- | ----------------- | ----------------- |
| Authenticated user in a tenant          | user's profile.name    | company.name      | system.name       |
| Authenticated user in core scope        | user's profile.name    | _(omit)_          | _(omit)_          |
| Anonymous request (public forms)        | _(omit)_               | company.name      | system.name       |
| System automatic action (jobs, workers) | i18n `common.system`   | tenant when known | tenant when known |
| Superuser action                        | superuser profile.name | _(omit)_          | _(omit)_          |

Templates show a field only when provided.

#### 15.6 Shared layout (`templates/<channel>/layout.ts`)

Each channel ships a `layout.ts` that wraps the rendered body. For
`email/layout.ts`, the output is a mobile-first, email-client-safe skeleton:

- 600 px max-width container; collapses on mobile via `<meta viewport>` +
  `@media (max-width: 600px)` (`table-layout: fixed`, inline fallback widths,
  padding). **Table-based layout only** — Flexbox/Grid don't render in most
  email clients.
- **Inline CSS only.** Class selectors live in a `<style>` block and are used
  only as media-query hooks. No external stylesheets, no JS, no webfonts
  (Arial/Helvetica + system stacks).
- Brand colors are **hardcoded** (email clients can't resolve CSS variables).
- CTA buttons are a `<table>` with a single `<a>` inside a padded cell; gradient
  applied as `background-image` with a solid-color fallback.
- Dark-mode: ship `<meta name="color-scheme" content="light dark">` +
  `@media (prefers-color-scheme: dark)` overrides for text + borders.
- **Preheader text:** first element in `<body>` is a hidden (`display:none`)
  preheader summarizing the content for inbox previews.
- **Tenant banner**: top of the card, always renders the trio (`actorName` ·
  `companyName` · `systemName`) whenever any of those are supplied — compact,
  non-decorative, separated by middle-dot glyphs.

For `sms/layout.ts`, the "layout" collapses to a plain-text assembly:
`[systemName] actorName · actionKey/eventKey · link` — short enough for most
carriers.

#### 15.7 Template body structure

Both templates share the same mandatory sections — the only difference is the
CTA and the facts table.

1. **Tenant banner** (`actorName` · `companyName` · `systemName`, when present).
2. **Hero icon** (envelope for confirmations, check/warning for notifications).
3. **Title** — `t(actionKey)` or `t(eventKey)`.
4. **Summary sentence** — fixed per template, interpolates `actorName`.
5. **Facts card** — `occurredAt` plus (for notifications) `resources`, `value`,
   `invoiceUrl`; (for confirmations) `expiryMinutes`.
6. **CTA button** —
   - human-confirmation: label `t("templates.humanConfirmation.action")` →
     `confirmationLink`.
   - notification: when `ctaUrl` + `ctaKey` supplied, renders `t(ctaKey)` →
     `ctaUrl`; else omitted.
7. **Footer** — `Core.getSetting("app.name")`, support link from
   `FrontCore.getSetting("front.support.email")`, and a "this message was sent
   to `<recipient>`" disclaimer.

i18n keys live under `templates.humanConfirmation.*` and
`templates.notification.*`. Action/event keys are owned by the publishing domain
(e.g. `auth.action.register`, `billing.event.paymentSuccess`).

#### 15.8 Channel handlers

Each channel ships a single event handler that:

1. Resolves the locale (§5.4) — prefer `templateData.locale` → owner profile
   locale → system default → `"en"`.
2. Resolves recipients. If a recipient string is a record id
   (`user:…`/`lead:…`), look up `entity_channel` rows where
   `ownerId = <id> AND type = <current channel> AND verified = true` and use
   their `value`. **The `entity_channel.type` always matches the delivery
   channel name** — `send_sms` resolves rows of type `"sms"`, `send_email`
   resolves rows of type `"email"`, `send_phone` (if a framework adds phone
   calls) resolves rows of type `"phone"`. Phone numbers and SMS destinations
   are stored as distinct channel rows because a phone number may or may not
   receive SMS (VoIP, landlines), and a texting-only line is not a voice line.
   If no recipients resolve, return
   `{ delivered: false, reason:
   "no-recipients" }` so the dispatcher tries
   the next channel.
3. Resolves senders: `payload.senders` → Core setting
   `communication.<channel>.senders`.
4. Resolves the template — `string` → look up
   `server/utils/communication/templates/<channel>/<template>.ts` default export
   (or the registered `TemplateBuilder`). `TemplateBuilder` → call it with
   `(senders, recipients, templateData, channel)`.
5. Renders and delivers through the external provider configured via Core
   settings (`communication.email.*`, `communication.sms.*`, …).
6. Returns `{ delivered: true }` on success.

Core ships `send_email` and `send_sms`. Subframeworks register additional
channels (e.g. `push`, `webhook`, `phone` for voice calls) with
`registerHandler("send_<channel>", fn)` + `registerChannel("<channel>")`.

#### 15.9 Dispatcher (`send_communication`)

Core registers `send_communication` as the handler for
`publish("send_communication", …)`:

1. Resolve `channels` — fall back to `auth.communication.defaultChannels` when
   empty.
2. Pick the first channel whose handler is registered (by convention the handler
   name is `send_<channel>`; frameworks register channels via
   `registerChannel(<channel>)` and their handler via
   `registerHandler("send_<channel>", fn)`).
3. `publish("send_<channel>", { channel, channelFallback, ...payload })` where
   `channelFallback` is the remaining suffix of `channels` after the picked
   entry. The per-channel handler, on delivery failure it can recover from (no
   recipients, missing template), dispatches to the next channel by publishing
   `send_<channelFallback[0]>` with the shortened tail.
4. If all channels are exhausted without success, the delivery is marked `dead`
   by the queue (`maxAttempts` applies per-channel handler, not per dispatcher).

Fallback wiring is purely data — adding a channel never requires patching the
dispatcher.

### 16. Jobs

- **`server/jobs/index.ts`** — boot entry point. Calls `registerCore()`,
  `registerAllSystems()`, then `registerAllFrameworks()` (§12.9) to populate the
  module registry, then starts the event queue and all registered recurring
  jobs.
- **`server/jobs/start-event-queue.ts`** — creates a worker per registered
  handler name with its `WorkerConfig`. Resolves handler functions from the
  module registry (`getHandler`) — never imports subsystem handlers directly.
- **`server/jobs/recurring-billing.ts`** — periodic (e.g. hourly) under the
  system Tenant. (1)
  `SELECT subscription WHERE status="active" AND
  currentPeriodEnd <= now()`;
  (2) for each, `publish("process_payment", …)`; the handler charges via the
  server payment provider.
  - **Success:** advance `currentPeriodStart`/`currentPeriodEnd`, reset
    `remainingPlanCredits = plan.planCredits + voucher.creditModifier` (0 when
    no voucher), reset `remainingOperationCount = resolveAllOperationCounts()`
    (full per-resourceKey map), reset `creditAlertSent =
    false`, reset
    `operationCountAlertSent` to `{}` (empty map), clear
    `retryPaymentInProgress = false`, create `payment` record with
    `status = "completed"` and `invoiceUrl`, publish `send_communication` with
    `template = "notification"` and
    `templateData.eventKey =
    "billing.event.paymentSuccess.recurring"`.
  - **Failure:** set `status = "past_due"`, clear
    `retryPaymentInProgress = false`, create `payment` record with
    `status = "failed"` and `failureReason`, publish `send_communication` with
    `template = "notification"` and
    `templateData.eventKey =
    "billing.event.paymentFailure.recurring"` (with
    gateway `reason` as a resource entry).
- **`server/jobs/token-cleanup.ts`** — daily under the system Tenant.
  Hard-deletes `api_token` rows where `revokedAt` is older than 90 days. Cleans
  orphaned `connected_app` rows whose underlying token was removed.

---

## Part E — Frontend

### 17. Frontend Architecture

#### 17.1 SurrealDB frontend connection (`src/lib/db/connection.ts`)

WebSocket via SurrealDB user/password authentication. Exclusively for
`LIVE
SELECT`. Credentials read from `setting` via `/api/public/front-core`.

```typescript
export async function connectFrontendDb(): Promise<Surreal>;
```

#### 17.2 Payment contracts

**Client-side** (`src/lib/payment/interface.ts`):

```typescript
export interface IClientPaymentProvider {
  tokenize(
    cardData: CardInput,
    billingAddress: Address,
  ): Promise<TokenizationResult>;
}
export interface CardInput {
  number: string;
  cvv: string;
  expiryMonth: string;
  expiryYear: string;
  holderName: string;
  holderDocument: string;
}
export interface TokenizationResult {
  cardToken: string;
  cardMask: string;
}
```

`src/lib/payment/credit-card.ts` implements this. Details depend on the
gateway's client SDK.

**Server-side** (`server/utils/payment/interface.ts`):

```typescript
export interface IPaymentProvider {
  charge(
    amountCents: number,
    params: Record<string, string>,
  ): Promise<PaymentResult>;
}
export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  invoiceUrl?: string;
}
```

`server/utils/payment/credit-card.ts` implements this. Used by the
`process_payment` event handler and the recurring-billing job.

#### 17.3 React hooks

| Hook               | File                            | Purpose                                                                                                                                                                                            |
| ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useDebounce`      | `src/hooks/useDebounce.ts`      | Debounced value (configurable delay)                                                                                                                                                               |
| `useAuth`          | `src/hooks/useAuth.tsx`         | Context+Provider. Holds opaque `token`. Exposes `login()`, `logout()`, `refresh()`, `exchangeTenant(companyId, systemId)`. Decodes the token's Tenant once and exposes it as `tenant` (read-only). |
| `useLiveQuery`     | `src/hooks/useLiveQuery.ts`     | Wraps `LIVE SELECT`; manages WebSocket; reactive data                                                                                                                                              |
| `useSystemContext` | `src/hooks/useSystemContext.ts` | Thin wrapper over `useAuth` exposing `tenant` + `companies[]`, `systems[]`, `switchCompany()`, `switchSystem()`. Switchers call `useAuth().exchangeTenant()` — never mutate local state directly.  |
| `useLocale`        | `src/hooks/useLocale.ts`        | `locale`, `setLocale()`, `t()`, `supportedLocales`                                                                                                                                                 |
| `usePublicSystem`  | `src/hooks/usePublicSystem.ts`  | Fetches public system info (no auth). Used by homepage + auth pages for branding.                                                                                                                  |
| `useFrontCore`     | `src/hooks/useFrontCore.tsx`    | Context+Provider. Lazily loads `FrontCore`; synchronous `get(key)`; reloads on live-query signal from admin panel.                                                                                 |

#### 17.3.1 Hook implementation rules

Every hook in `src/hooks/` must follow these rules. Violations are bugs.

**1. Shared-app-state hooks use Context + Provider.** Any hook whose state must
be consistent across multiple components (`useAuth`, `useFrontCore`,
`useLocale`, `useSystemContext`) implements the Context + Provider pattern:

- A single `*Provider` component (e.g. `AuthProvider`, `FrontCoreProvider`)
  holds the state and all mutation functions via `useState` / `useCallback`.
- The provider is mounted once in `app/layout.tsx`, wrapping all children.
- The corresponding `use*()` hook reads from `useContext` — never creates its
  own independent state.
- Hooks that are truly component-scoped (`useDebounce`, `usePublicSystem`,
  `useLiveQuery`) may use local state since each instance is independent.

**2. All closures must list every captured value in deps.** Every `useCallback`
and `useEffect` must include every outer variable it reads in its dependency
array. Missing deps produce stale closures — the function operates on outdated
values. Object-type deps that are constructed inline (e.g. `bindings`) must be
stabilized via `useMemo` to avoid infinite re-execution.

**3. Async effects must include cancellation guards.** Every `useEffect` that
calls an async function must declare `let cancelled = false` before the async
call and return a cleanup function that sets `cancelled = true`. All `setState`
calls inside the async body must be guarded by `if (!cancelled)`. This prevents
stale responses from overwriting fresh data when deps change rapidly (e.g. slug
changes, query changes) and prevents setState on unmounted components.

**4. No fire-and-forget data fetches.** Every `fetch()` inside a hook must be
inside a `useEffect` with proper deps, or inside a `useCallback` whose result is
consumed by a `useEffect`. Never call `fetch` at the top level of a hook body
(outside useEffect / useCallback) — it runs on every render.

**5. Loading guards on data-fetching callbacks.** Any `useCallback` that
performs an authenticated API call (reads `systemToken`) must:

- Include `systemToken` in its dependency array.
- Early-return if `systemToken` is null / undefined.
- This prevents API calls with `Authorization: Bearer null` that produce 401s.

**6. useMemo for derived values from context.** Computed values extracted from
context state (e.g. `tenant` decoded from `systemToken`) must use `useMemo` with
the source value as a dependency, not be computed inline on every render.

**7. Provider file extensions are `.tsx`.** Any hook file containing JSX
(Provider components with `<Context.Provider>`) must use the `.tsx` extension.
Pure-logic hooks (no JSX) use `.ts`.

#### 17.4 Single-token rule

The frontend stores **only** the opaque token string from `/api/auth/login` and
`/api/auth/exchange`. No React context or hook stores `companyId`, `systemId`,
`roles`, or `permissions` independently — they are derived from the decoded
token via `useAuth().tenant`. Every `fetch` wrapper pulls the token from
`useAuth()` and sets `Authorization: Bearer <token>`. This is the one
enforcement point that keeps the frontend free of scattered tenant state.

### 18. UI Components

#### 18.1 Generic primitives (all in `src/components/shared/`)

| Component                                          | Notes                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Spinner`                                          | Tailwind `animate-spin` on a circular border. Props: `size?: "sm" \| "md" \| "lg"`. Rendered on every async action (§1.1.3).                                                                                 |
| `Modal`                                            | Standard modal chrome.                                                                                                                                                                                       |
| `LocaleSelector`                                   | §5.5.                                                                                                                                                                                                        |
| `SearchField`                                      | Debounced (`useDebounce`).                                                                                                                                                                                   |
| `CreateButton` / `EditButton` / `DeleteButton`     | Standard entity-row controls.                                                                                                                                                                                |
| `FormModal`                                        | See §18.2.                                                                                                                                                                                                   |
| `GenericFormButton`                                | Submit with embedded Spinner.                                                                                                                                                                                |
| `ErrorDisplay`                                     | Surfaces server-side error i18n keys.                                                                                                                                                                        |
| `FilterDropdown`, `DateRangeFilter`, `FilterBadge` | See §18.2.                                                                                                                                                                                                   |
| `DownloadData`                                     | Exports rows as XLSX (see §18.1.1).                                                                                                                                                                          |
| `BotProtection`                                    | CAPTCHA / challenge widget (§19.9). Backend verifies `botToken`.                                                                                                                                             |
| `SystemBranding`                                   | Logo + name block used on auth pages.                                                                                                                                                                        |
| `Sidebar`, `SidebarMenuItem`, `SidebarSearch`      | §18.6.                                                                                                                                                                                                       |
| `ProfileMenu`                                      | §18.7.                                                                                                                                                                                                       |
| `TagSearch`                                        | §18.4.                                                                                                                                                                                                       |
| `PlanCard`                                         | §18.10. Shared plan card used in billing, onboarding, and core plans. Exports `formatBytes()`, `formatPrice()`, `limitEmoji()`.                                                                              |
| `UsagePage`                                        | §21.5. Dual-mode (`tenant`                                                                                                                                                                                   |
| `TranslatedBadge`                                  | §18.1.2. Compact badge that resolves a role/permission/entity/resource token into its translation via the standard structure (§5.6.1). Shows both the raw token and its translated label stacked vertically. |
| `CookieConsent`                                    | §18.1.3. Global data-tracking consent popup.                                                                                                                                                                 |

##### 18.1.1 `DownloadData`

```
Props: {
  data: Record<string, unknown>[] | (() => Promise<Record<string, unknown>[]>);
  fileName?: string;   // default "export" (no extension)
  sheetName?: string;  // default "sheet1"
  label?: string;      // default i18n key "common.download"
}
```

If `data` is a function, it is called on click with an inline Spinner inside the
button. Uses `xlsx` to build the workbook, writes a compressed array buffer, and
triggers a browser download via a temporary `<a>` + `URL.createObjectURL`. Empty
results or thrown errors leave the button in idle state. Follows the
glassmorphism standard.

##### 18.1.2 `TranslatedBadge`

Compact badge that resolves a machine-readable token (role, permission, entity,
resource) into its translation via the standard i18n structure (§5.6.1) and
renders the token and its translation stacked vertically so operators can see
both at a glance.

```typescript
interface TranslatedBadgeProps {
  kind: "role" | "permission" | "entity" | "resource";
  token: string; // raw identifier — e.g. "admin", "faceDetection"
  systemSlug?: string; // scope override; when set, tries system-scoped key first
  frameworkName?: string; // scope override; when set, tries framework-scoped key first
  onRemove?: () => void; // when provided, renders an "x" to remove
  compact?: boolean; // when true, shows ONLY the translation (human mode)
}
```

**Palette.** Each `kind` has a fixed Tailwind palette — `role` →
`--color-primary-green`, `permission` / `resource` → `--color-secondary-blue`,
`entity` → `--color-light-green`. The badge renders as a tinted pill (10%
background, 40% border). No per-call color override exists; the palette is
structural so consumers stay consistent across the app.

**Key resolution** (first non-literal wins — if the lookup returns the key
itself, it is treated as "not found" and the next candidate is tried):

1. `systems.<systemSlug>.<kind>s.<token>` (when `systemSlug` provided).
2. `frameworks.<frameworkName>.<kind>s.<token>` (when `frameworkName` provided).
3. `<kind>s.<token>` (core default — `roles.admin`,
   `permissions.core.users.read`, …).
4. Falls back to the raw `token` when no translation exists.

**Visual layout.**

- **Default (both lines).** Rounded pill; raw token in
  `font-mono text-xs text-white`; translated label below it in
  `text-[10px] text-[var(--color-light-text)]`. When no translation exists, the
  badge collapses to the raw token only.
- **`compact` (translation only).** The pill renders a single line with just the
  translated label. The raw token is hidden because the reader has no technical
  context for it. When no translation exists, the raw `token` is rendered as the
  single line — it is the only label available.

**Usage rules:**

- Forms, admin lists, token/connected-app cards, menu editors, and any operator
  surface where the identifier is being authored or audited MUST render
  `TranslatedBadge` with `compact` **omitted** (default). The operator needs the
  raw token for code / config references in addition to the translated label.
- User-facing informational surfaces (plan cards §18.10, usage panel §21.5,
  OAuth consent page §24) that use `TranslatedBadge` MUST pass `compact = true`
  so the raw identifier is never shown to end users. The equivalent is calling
  `t()` and rendering the result — `compact` simply lets those surfaces reuse
  the badge's key-resolution fallback chain.
- `MultiBadgeField` (§18.4) accepts an optional `renderBadge` prop; consumers
  pass a function that returns a `TranslatedBadge` (default, non-compact) to
  replace the default chip for roles/permissions/entities/resources.

##### 18.1.3 `CookieConsent`

Global data-tracking consent popup that appears on **every page** — public and
authenticated alike — until the user records a decision.

**Behavior:**

1. Reads the `core_data_tracking_consent` cookie. Values: `"accepted"`,
   `"declined"`, or missing.
2. When the cookie is missing, renders a fixed bottom-of-screen card with the
   consent message, the "Terms of Service & LGPD Privacy Policy" link, an Accept
   button, and a Decline button.
3. Clicking either button writes the cookie with a **6-month lifetime**
   (`days = 180`) and dismisses the popup.
4. The message itself uses the i18n key `common.cookieConsent.message` (EN:
   "This website uses data tracking technology.", PT-BR: "Este site usa
   tecnologia de rastreamento de dados.").
5. The Terms link opens `/terms?system=<slug>` in a new tab (same slug resolved
   for the current page; falls back to `app.defaultSystem` on public pages).
6. While no decision is recorded, any frontend code that captures or records
   characteristics listed in `front.dataTracking.trackedCharacteristics` MUST
   bail out. The hook `useDataTrackingConsent()` exposes
   `{ accepted: boolean, decided: boolean }` for consumers to gate their capture
   logic.

**Contract:**

```typescript
export interface DataTrackingConsentState {
  accepted: boolean; // true only when the cookie equals "accepted"
  decided: boolean; // true once either button is clicked
  trackedCharacteristics: string[]; // resolved from FrontCore at render time
}
```

`CookieConsent` is mounted once in `app/layout.tsx` inside `FrontCoreProvider`
(so the settings hook is available) and above every route group so it spans
public and authenticated pages alike. It never leaves the tree — visibility is
controlled by the cookie check and a React state transition, and auth state is
irrelevant: anonymous visitors see the same popup as logged-in users on their
first page view.

#### 18.2 List / CRUD system

`GenericList` (`src/components/shared/GenericList.tsx`):

```
Props: {
  entityName: string;
  searchEnabled?: boolean;
  createEnabled?: boolean;
  filters?: FilterConfig[];
  fetchFn: (params: CursorParams & { search?; filters? }) => Promise<PaginatedResult<T>>;
  renderItem?: (item: T, controls: ReactNode) => ReactNode;
  fieldMap?: Record<string, FieldType>;   // default renderer
  controlButtons?: ("edit" | "delete")[]; // default both
  actionComponents?: {                    // custom action components per row
    key: string;
    component: React.ComponentType<{ item: T }>;
  }[];
  debounceMs?: number;                    // default 300
  formSubforms?: SubformConfig[];
  createRoute?: string;
  editRoute?: (id: string) => string;
  deleteRoute?: (id: string) => string;
  fetchOneRoute?: (id: string) => string;
}
```

Behavior: debounced `SearchField`; `CreateButton` opens a `FormModal`;
`EditButton` fetches the full entity via `fetchOneRoute` then opens `FormModal`
in edit mode; `DeleteButton` confirms then refreshes; cursor-based pagination
(Load More / Prev-Next); filters through `FilterDropdown`, applied filters shown
as `FilterBadge`.

`GenericListItem` renders `"fieldName: formattedValue"` per row, formatted by
`FieldType`:

```typescript
export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "phone"
  | "url"
  | "currency"
  | "file"
  | "json";
```

Common types:

```typescript
export interface CursorParams {
  cursor?: string; // opaque
  limit: number; // 1..200, capped server-side
  direction?: "next" | "prev";
}
export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total?: number;
}
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}
```

`FilterDropdown` — compact dropdown revealing configured filters.

`DateRangeFilter` —
`Props: { maxRangeDays: number; onChange: (s: Date, e: Date) => void }`.

`FilterBadge` — `Props: { label: string; onRemove: () => void }`.

`FormModal`:

```
Props: {
  title: string;                   // i18n key
  subforms: SubformConfig[];
  submitRoute: string;
  method: "POST" | "PUT";
  initialData?: Record<string, unknown>;
  onSuccess: () => void;
  onClose: () => void;
}
```

Renders subforms vertically; each exposes `getData()` + `isValid()` via
`useImperativeHandle`. Submit button is `GenericFormButton` with a Spinner.
`ErrorDisplay` shows server errors. On submit: collect from all subforms, merge,
send.

#### 18.3 Field-selection policy — prefer smart fields over plain inputs

**Every form field that accepts structured or relational data MUST use the
appropriate smart component.** Plain `<input type="text">` is reserved for truly
free-form strings (person name, description).

| Data type                                                                      | Required component                                                  | Notes                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Multiple free-text values (permissions, tags, benefits)                        | `MultiBadgeField mode:"custom"`                                     | Type + Enter to add                                      |
| Multiple values from a known backend set (roles, system permissions, plan IDs) | `MultiBadgeField mode:"search"` with `fetchFn`                      | Only backend values; no arbitrary text                   |
| Single or multiple related records (system, plan, role, company)               | `SearchableSelectField`                                             | Debounced API search; selected items as removable badges |
| Static small option set                                                        | `MultiBadgeField mode:"search"` with `staticOptions`, or `<select>` | `<select>` only when fixed and tiny (≤ 6 items)          |
| Key-value pairs (settings, entity limits)                                      | `DynamicKeyValueField`                                              | Never `<textarea>` for JSON/CSV KV data                  |
| File or image                                                                  | `FileUploadField`                                                   | Never a plain text URL input for uploaded assets         |

**Never use a plain comma-separated `<input>` or `<textarea>` for:**

- Permissions arrays (use `MultiBadgeField` `mode:"custom"` or `"search"`).
- Role assignments (use `mode:"search"` fetching `/api/core/roles`).
- Benefit lists, plan permissions, voucher permissions
  (`MultiBadgeField mode:"custom"`).
- Any field referencing a DB entity by ID or name (`SearchableSelectField`).

**`mode:"search"` vs `mode:"custom"`**

- `"search"` — valid values defined server-side (roles, permission strings that
  already exist, plan IDs, tag names). User cannot invent values.
- `"custom"` — open-ended strings the user defines (e.g. new permission strings
  on a new role, benefit labels on a new plan).

**`SearchableSelectField` vs `MultiBadgeField mode:"search"`**

- `SearchableSelectField` for **record references** — emits `{ id, label }[]`
  (selecting a system/plan/company).
- `MultiBadgeField mode:"search"` for **string values** from a backend set —
  emits strings or `{ name, color }` objects.

**ProfileMenu selectors** use `SearchableSelectField` with `multiple={false}`
and `showAllOnEmpty`; `fetchFn` filters the local array.

#### 18.4 Reusable field components (`src/components/fields/`)

**`FileUploadField`**

```
Props: {
  fieldName: string;
  systemSlug: string;            // always required — form must enforce it before upload is enabled
  category: string[];            // e.g. ["logos"] or ["documents","invoices"]
  fileUuid?: string;             // existing UUID for replacement; omitted for new file (frontend generates one)
  previewEnabled?: boolean;      // rounded avatar preview
  descriptionEnabled?: boolean;
  onComplete: (uri: string) => void;
}
```

Sends FormData to `/api/files/upload` with `file` (stream), `systemSlug`,
`category` (JSON string), `fileUuid`, optional `description`. The component
generates a new `crypto.randomUUID()` for new files and reuses the existing UUID
when replacing. Always sends the `Authorization` header when a token is
available. The server resolves `companyId` and `userId` from the tenant context
(§13.2). Shows progress bar, cancel, delete. Preview (if enabled) shows a
rounded image suitable for avatars. Emits the file URI on completion.

**`SearchableSelectField`**

```
Props: {
  fetchFn: (search: string) => Promise<{ id: string; label: string }[]>;
  debounceMs?: number;
  multiple?: boolean;
  onChange: (selected: { id: string; label: string }[]) => void;
}
```

Debounced text → `fetchFn` → dropdown → removable badges.

**`DynamicKeyValueField`**

```
Props: {
  fields: { key: string; value: string; description: string }[];
  onChange: (fields: { key: string; value: string; description: string }[]) => void;
}
```

Used by the core settings editors.

**`MultiBadgeField`**

```
Props: {
  name: string;
  mode: "custom" | "search";
  value: (string | { name: string; color?: string })[];
  onChange: (value: (string | { name: string; color?: string })[]) => void;
  fetchFn?: (search: string) => Promise<(string | { name: string; color?: string })[]>;
  staticOptions?: (string | { name: string; color?: string })[];
  formatHint?: string;         // e.g. "e.g. core.users.read, core.billing.write"
  debounceMs?: number;         // default 300
}
```

Behavior:

- Input on top; badges below in a `flex-wrap` container.
- `mode:"custom"`: user types and presses Enter. `fetchFn`/`staticOptions` (if
  provided) show suggestions, but the user can still add values not in the list.
- `mode:"search"`: user can only pick from `fetchFn`/`staticOptions`. Free text
  is blocked.
- `fetchFn` debounced with inline Spinner while loading. `staticOptions`
  filtered locally.
- Each badge has an "x" to remove. Already-selected values are excluded from the
  suggestion dropdown.
- String items → badge text is the string. Object items → badge shows `name`; if
  `color` is set, the badge background is that hex color.

Used by Roles (permissions), Plans (permissions, benefits), Vouchers
(permissions), Menus (requiredRoles, hiddenInPlanIds), and anywhere a legacy
comma-separated textarea would appear.

**`TagSearch`** (`src/components/shared/TagSearch.tsx`)

```
Props: {
  value: string[];       // tag IDs
  onChange: (tagIds: string[]) => void;
  label?: string;        // default "common.tags"
  debounceMs?: number;   // default 300
}
```

Wraps `MultiBadgeField mode:"search"` with a `fetchFn` calling
`/api/tags?search=`. Converts between the `{ name, color, id }` badge format and
the flat string-array of IDs consumers expect. Badges show the tag name in its
color. Designed for list toolbars / filter panels.

#### 18.5 Subform components (`src/components/subforms/`)

Every subform exposes:

```typescript
interface SubformRef {
  getData(): Record<string, unknown>;
  isValid(): boolean;
}
interface SubformProps {
  initialData?: Record<string, unknown>;
  requiredFields?: string[];
  optionalFields?: string[];
}
```

| Subform                        | Fields                                                                                                                                       | Used by                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `ProfileSubform`               | `name`, `avatarUri` (FileUploadField), `age`                                                                                                 | Users, Agents                   |
| `ContactSubform`               | `email`, `phone`                                                                                                                             | User register/edit              |
| `PasswordSubform`              | `password`, `confirmPassword`                                                                                                                | User register/edit              |
| `PasswordChangeSubform`        | `currentPassword`, `newPassword`, `confirmPassword`. Submits `POST /api/auth/password-change` which requires human confirmation (§19.14)     | ProfilePage                     |
| `AddressSubform`               | `street`, `number`, `complement`, `neighborhood`, `city`, `state`, `country`, `postalCode`                                                   | Company, PaymentMethod          |
| `CompanyIdentificationSubform` | `name`, `document`, `documentType`                                                                                                           | Company create/edit             |
| `CreditCardSubform`            | `number`, `cvv`, `expiryMonth`, `expiryYear`, `holderName`, `holderDocument` + embedded `AddressSubform`                                     | Payment method                  |
| `NameDescSubform`              | `name`, `description` (configurable required fields and char limits)                                                                         | Tokens, Connected Apps, generic |
| `EntityChannelsSubform`        | Entity channels (email/phone/…), verification status, add/remove/resend. Props: `channelTypes: string[]`, `requiredTypes: string[]` (§19.13) | Profile, Lead editor            |
| `LeadCoreSubform`              | Lead identification, contact, profile, tags                                                                                                  | Leads                           |

#### 18.6 Sidebar

- Starts hidden (mobile-first). Hamburger button toggles.
- Closes on outside click or menu-item click.
- Contains `SidebarSearch` at top + recursive `SidebarMenuItem`.
- Menu items loaded from the Core for the active system.
- Items with roles not matching the user's roles are hidden. Items listed in the
  plan's `hiddenInPlanIds` are hidden.

`SidebarMenuItem` — recursive, unlimited depth. Click expands/collapses
children; leaf items navigate to the mapped component. Search filter: a child
match keeps the parent visible.

`SidebarSearch` — uses `useDebounce` to filter as the user types.

#### 18.7 ProfileMenu (top bar of `(app)` layout)

1. User avatar / name — clickable to open.
2. **Company selector** — `SearchableSelectField` (`multiple={false}`,
   `showAllOnEmpty`) listing the user's companies. Selected = badge.
3. **System selector** — `SearchableSelectField` (`multiple={false}`,
   `showAllOnEmpty`) listing systems the current company subscribes to (active
   subscriptions only).
4. Profile link.
5. Logout — clears tokens, redirects to `/login`.

Changing company or system calls `useAuth().exchangeTenant(companyId,
systemId)`
which performs the token exchange (§19.11). The new token replaces the stored
one; sidebar menus reload for the new Tenant; all context-dependent data (usage,
billing) re-reads from `useAuth().tenant`. Because the token is the sole source
of truth, no other state needs manual reset.

Changing company resets the system selector to the first system of the newly
selected company.

#### 18.8 System context, branding, initial-page rule

All `(app)` pages consume `useSystemContext()` for company id, system slug,
plan, roles — used to load the correct logo, translations, menus, and
system-specific components.

**`(app)` layout responsibilities:**

1. **Onboarding guard** on mount: no companies → redirect `/onboarding/company`;
   companies but no active subscriptions → `/onboarding/system`.
2. **Default context** when onboarding is complete: first company + its first
   subscribed system.
3. **Context persistence** via `core_company` + `core_system` cookies — survives
   reloads; fallback to first/first when cookies are invalid.

**Sidebar branding.** The `(app)` layout passes the active system's `logoUri`
(resolved via the download endpoint) and `name` to the sidebar. **The sidebar
MUST NEVER display "Core"** — that label is reserved for the `(core)` layout. If
no system is selected yet, show a `Spinner` instead of a fallback name.

**Menu loading.** Fetch the system's custom menus from
`GET /api/core/menus?systemId=...` filtered by the user's roles + plan. Then
**append the hardcoded shared default menus** (usage, billing, users,
company-edit, connected-apps, tokens) with `sortOrder` offset by
`max(customSortOrder) + 1` so they always appear **after** the custom items.
When no custom menus exist, only the defaults render. Creating custom menus
never hides the shared defaults.

**Initial-page rule.** The initial page is the **first menu item with a
non-empty `componentName`**, resolved by depth-first traversal of the full menu
tree (custom first, then shared defaults, ordered by `sortOrder`).
`findFirstComponent(tree)` produces the route. The layout navigates to
`/<componentName>` in three situations: (1) initial load after login; (2)
company switch; (3) system switch. The login redirects to `/entry` — a
lightweight spinner-only landing page at `app/(app)/entry/page.tsx` that never
renders real content. This avoids loading any component before the layout
resolves the target route. If the system defines custom menus, the first custom
one becomes the landing page; otherwise the first default menu item is used.

#### 18.9 Public homepages

Each system has a dedicated `.tsx` homepage component with full creative freedom
(within the visual standard). No shared template.

**Router:** `app/page.tsx`:

1. Read `?system=<slug>`.
2. Else `app.defaultSystem` via `/api/public/system?default=true`.
3. Else render the **core homepage inline** — welcome + "Get Started" →
   `/login`.

Successful resolution: fetch public system info, look up the homepage component
in the **homepage registry**
(`src/components/systems/registry.ts → getHomePage(slug)`), render inside
`<Suspense>`.

**Registry:**

```typescript
registerHomePage(
  "my-system",
  () => import("@/src/components/systems/my-system/HomePage"),
);
```

Homepage components live at `src/components/systems/[slug]/HomePage.tsx`. They
receive no props; they use `useLocale()` and link to `/login?system=<slug>`.

#### 18.10 PlanCard (`src/components/shared/PlanCard.tsx`)

Shared plan card component used in three contexts: **billing** (current plan +
available plans), **onboarding** (plan selection), and **core plans** (admin
CRUD).

```
interface PlanCardProps {
  plan: {
    id, name, description, price, currency, recurrenceDays,
    benefits: string[], permissions?: string[],
    entityLimits?: Record<string, number> | null,
    apiRateLimit, storageLimitBytes, fileCacheLimitBytes?, planCredits?,
    maxConcurrentDownloads?, maxConcurrentUploads?,
    maxDownloadBandwidthMB?, maxUploadBandwidthMB?,
    maxOperationCount?: Record<string, number> | null,
    isActive?: boolean;
  };
  variant: "billing" | "onboarding" | "core";
  highlighted?: boolean;          // green border + shadow + -translate-y-1
  badges?: React.ReactNode;       // top-right slot (e.g. "Current Plan")
  actions?: React.ReactNode;      // bottom slot (e.g. Subscribe, Edit, Delete)
  voucherPrice?: { original: number; effective: number; currency: string };
  onClick?: () => void;           // renders <button> when present, <div> when absent
  systemName?: string;            // shown under name (core variant only)
}
```

**Variant behavior:**

- `variant="billing"` / `"onboarding"` → full descriptive limits list
  (`LimitsFull`).
- `variant="core"` → compact key-value table (`LimitsCompact`) + permissions
  chips.

**Shared exports:** `formatBytes()`, `formatPrice()`, `limitEmoji()` — used by
consumers that need the same formatting outside the card (e.g. BillingPage
current-plan section).

**Visual layout** (identical rich glassmorphism design across all variants):

Used in both `/onboarding/system` and the billing page — identical rich
glassmorphism design.

```
┌─────────────────────────────────────────────┐
│  [Plan Name]                    [Price/mo]  │
│  [Description]                              │
│  ── Benefits ──                              │
│  ✓ Benefit 1 (translated)                   │
│  ✓ Benefit 2 (translated)                   │
│  ── Limits ──                                │
│  📊 API Rate: 1,000 req/min                 │
│  💾 Storage: 1 GB                           │
│  🗂️ File Cache: 20 MB                      │
│  👥 Users: 50                               │
│  ⬇️ Max Downloads: 5 concurrent             │
│  ⬆️ Max Uploads: 3 concurrent               │
│  📶 Download BW: 10 MB/s                    │
│  📶 Upload BW: 5 MB/s                       │
│  🔢 Operation Count: 1,000                   │
│  [Subscribe / Current Plan badge]           │
└─────────────────────────────────────────────┘
```

- Card:
  `backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6`.
  Current/selected:
  `border-[var(--color-primary-green)] shadow-lg shadow-[var(--color-light-green)]/20 -translate-y-1`.
- Plan name: `text-xl font-bold text-white` via `t()`.
- Price: `text-2xl font-bold text-[var(--color-primary-green)]`. Free plans
  render a translated "Free" badge
  (`bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full`).
  Paid plans show formatted currency + recurrence (e.g. "$9.99 / 30 days").
- Description: `text-sm text-[var(--color-light-text)]` via `t()`.
- Benefits: gradient header, each benefit on its own line with a green `✓`;
  benefit strings are i18n keys via `t()`.
- Limits: gradient header, each limit with an emoji + formatted value.
  `plan.entityLimits` keys rendered via `t("billing.limits." + key)`.
  `apiRateLimit` + `storageLimitBytes` use human-readable formatting. Transfer
  limits: `maxConcurrentDownloads`, `maxConcurrentUploads`,
  `maxDownloadBandwidthMB`, `maxUploadBandwidthMB` displayed with transfer
  emojis. `maxOperationCount` — per-resourceKey map rendered the same way as
  `entityLimits`: each key displayed with translated label, value as formatted
  number (e.g. "1,000 face detections"). A value of `0` or absent key renders
  `t("billing.limits.unlimited")`.
- Subscribe button: gradient button. The current plan replaces it with a
  "Current Plan" badge.

**Voucher-adjusted effective price.** When the subscription has an active
(non-expired) voucher whose `applicablePlanIds` is empty OR contains the current
plan, show the original price with `line-through` and the effective price
prominently next to it. `voucher.priceModifier` is a signed value: positive
increases the price (surcharge), negative decreases it (discount). Effective
price = `plan.price + voucher.priceModifier` clamped to ≥ 0. This is cosmetic on
the frontend — server-side charge calculations (recurring billing job + credit
purchase handler) must also apply the voucher's modifiers.

#### 18.11 Charts

Every page can use `react-chartjs-2` (Bar/Line/Pie). Charts render inside
glassmorphism cards following the visual standard. Data is fetched from
system-specific API routes.

---

## Part F — Functional Features (low-level → high-level)

### 19. Authentication

#### 19.1 Token architecture

| Token            | Purpose                        | Issued by                 | Transport                       |
| ---------------- | ------------------------------ | ------------------------- | ------------------------------- |
| System API Token | API requests to backend routes | Backend via `@panva/jose` | `Authorization: Bearer <token>` |

Frontend live queries authenticate via SurrealDB user/password credentials
stored in `setting` (`db.frontend.user`, `db.frontend.pass` — §7.5), not via a
separate token. The system token refreshes via `/api/auth/refresh`.

#### 19.2 System branding on public pages

All unauthenticated pages (homepage, login, register, forgot-password,
reset-password, verify, terms) read `?system=<slug>`. When present, the page
fetches `/api/public/system?slug=<slug>` and renders the system logo + name in
the header above the form. Auth page links (login ↔ register, forgot-password →
login, etc.) preserve the `?system=` parameter so branding stays consistent
across the entire unauthenticated flow.

Without `?system=`, pages show the core app name (`app.name`) with no logo.

#### 19.3 Account-approval invariant (entity-channel-based)

An account (user or lead) is **"approved"** only when its profile has **at least
one verified `entity_channel`**. The system never stores identity fields
(email/phone) directly on `user` or `lead` — all identity values flow through
`entity_channel` rows linked via `profile.channels` (§8). The previous boolean
`emailVerified`/`phoneVerified` flags have been removed.

Approval gates:

- Login (§19.5) requires at least one verified channel.
- API authentication (via `withAuth`) treats accounts without a verified channel
  as "pending" and rejects non-verification routes.
- Profile edits that change a verified channel require human confirmation
  (§19.13).

#### 19.4 Registration flow

1. User submits: password, optional `name`, and a `channels: {type, value}[]`
   array (at least one entry required; default UI offers `email` and `phone`).
   Bot protection validated.
2. Backend validates `termsAccepted: true`; rejects with
   `validation.terms.required` if missing.
3. Auth rate limit check (aggressive).
4. **Conflict check.** For each submitted `{type, value}`, look up existing
   `entity_channel` rows with the same `(type, value)` whose owner is a `user`.
   The registration is rejected with `validation.channel.conflict` when any
   conflicting channel is either (a) `verified = true`, or (b) unverified but
   still within an active, non-expired confirmation window (a non-used
   `verification_request` with `actionKey = "auth.action.register"` pointing at
   that owner). Abandoned accounts — no verified channel and no pending
   confirmation — are hard-deleted by the registration handler in the same
   batched query before the new user is created.
5. Password hashed via `crypto::argon2::generate(password)` inside SurrealDB.
6. Create `profile` with `channels = []`, then `user` referencing the profile.
7. Create one `entity_channel` row per submitted channel with
   `ownerId = user.id`, `ownerType = "user"`, `verified = false`, and append
   each channel record to `profile.channels` — all in the same batched query
   (§7.2).
8. For every channel of a type that appears in
   `auth.communication.defaultChannels`, open a `verification_request` via
   `communicationGuard()` with `actionKey = "auth.action.register"` and
   `payload = { channelIds: [<channel ids verified by this confirmation>] }`.
   The confirmation link hits `/api/auth/verify` with the token and marks every
   referenced channel `verified = true` in one atomic batched update.
9. Publish a **single** `send_communication` with:
   - `channels` = the `type`s of the user's newly-created channels, ordered to
     match the user's submitted preference (falling back to the core default).
   - `recipients` = the new `user.id`.
   - `template` = `"human-confirmation"`.
   - `templateData.actionKey` = `"auth.action.register"`.
10. Login is blocked until at least one `entity_channel` belonging to the user
    reaches `verified = true`.

#### 19.5 Login flow

1. Bot protection validated.
2. Auth rate limit check.
3. Resolve the user: find a **verified** `entity_channel` whose `value` matches
   the submitted identifier (email, phone, or any framework-registered channel
   value). Reject with `auth.error.invalidCredentials` when no verified channel
   matches.
4. Verify password with `crypto::argon2::compare()`. Reject with
   `auth.error.invalidCredentials` on mismatch.
5. If the user has **no** verified channel, reject with
   `auth.error.notVerified`. (Step 3's verified-only lookup already prevents
   this, but the check also covers edge cases where the identifier matched a row
   that was un-verified between steps.)
6. **Second-factor gate (user-level, §19.15).**
   - If `user.twoFactorEnabled = false`: proceed to step 7.
   - If `user.twoFactorEnabled = true`:
     - If the request body includes a `twoFactorCode` and `user.twoFactorSecret`
       is set, verify TOTP. Success → step 7. Invalid → reject with
       `auth.error.twoFactorInvalid`.
     - If the request body includes a `twoFactorToken`, resolve the verification
       request (`actionKey = "auth.action.loginFallback"`) and confirm it points
       at this user. Success → step 7.
     - Otherwise reject with `auth.error.twoFactorRequired` to prompt the client
       to either collect a TOTP code OR call
       `POST /api/auth/two-factor/login-link` to receive a human-confirmation
       link on one of the user's verified channels (§19.15.3). The fallback is
       always available — even when TOTP is configured — so losing the
       authenticator app never locks the user out.
7. Issue System API Token (short-lived from `auth.token.expiry.minutes`;
   extended by `auth.token.expiry.stayLoggedIn.hours` when `stayLoggedIn`).
8. Return the System API Token to the client.

#### 19.5 Post-login routing

1. **Superuser** → `/systems` (core admin panel). Skips onboarding.
2. **No companies** → `/onboarding/company`.
3. **Companies but no active subscriptions** → `/onboarding/system`. Two-step
   flow: (1) pick system, (2) pick plan. On submit, `POST /api/billing` with
   `action: "subscribe"` creates the `company_system` association and the
   subscription in one batched query (§22.1). Free plans require no payment
   method.
4. **Onboarding complete** → `/entry` (spinner-only landing pad, §18.8). The
   `(app)` layout then loads menus and navigates to the first menu item's
   component.

`(app)` layout checks `GET /api/companies/{companyId}/systems`; empty response →
redirect `/onboarding/system`.

The initial page opens with the **default context** (first company + its first
subscribed system), resolved by the `(app)` layout on mount.

#### 19.6 Company / system switching

After initial onboarding, the user switches via **ProfileMenu** (§18.7). Company
change resets the system selector to the first system of the new company. Both
changes call `useAuth().exchangeTenant()` (§19.11), which updates
`useSystemContext`, reloads menus, usage, billing, and all context-dependent UI,
and navigates to the first menu item's component (§18.8 initial-page rule).

#### 19.7 Password recovery

1. Submit any verified channel value (email, phone, framework channel). Bot
   protection + auth rate limit.
2. Resolve the owning user by looking up `entity_channel` rows with
   `verified = true` and `value = <submitted>`. When no match, still return a
   generic success (anti-enumeration).
3. `communicationGuard()` (§12.13) enforces previous-not-expired + rate-limit
   rules against the user + action `"auth.action.passwordReset"`. Generic
   success on block.
4. Publish `send_communication` with:
   - `channels` = the `type` of the matched channel **followed by** the user's
     remaining verified channel types (ordered by
     `auth.communication.
     defaultChannels` for ties).
   - `recipients` = the user's id.
   - `template` = `"human-confirmation"`.
   - `templateData.actionKey` = `"auth.action.passwordReset"`.
5. User clicks the link → `/reset-password` page validates the token → submits
   the new password → backend updates `passwordHash` and marks the request
   `usedAt`.

The `/account-recovery` page is the **same** flow — there is no longer a
separate "recovery channel reset". Any verified channel is accepted uniformly.

#### 19.8 OAuth login flow (when `auth.oauth.providers` is a non-empty JSON array)

The only OAuth configuration key is `auth.oauth.providers`. A non-empty JSON
array enables OAuth login and lists the providers to render on the login page;
an empty array (the seeded default) disables it entirely — there is no redundant
`auth.oauth.enabled` flag.

1. Redirect to provider.
2. Callback: verify OAuth token, extract email.
3. If user exists → link OAuth provider, issue tokens.
4. If not → create the user, then create a verified `entity_channel` of type
   `"email"` and the matching `verification_request` marked
   `usedAt = time::now()`, all in the same batched query (§7.2). Issue tokens.

#### 19.9 Security measures

| Measure               | Setting / implementation                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limiting         | Auth routes tighter than general routes (`auth.rateLimit.perMinute`, default 5/min/IP).                                                                                                       |
| Bot protection        | `BotProtection.tsx` on login/register/forgot-password. Backend verifies the challenge token.                                                                                                  |
| Verification cooldown | `communicationGuard()` (§12.13): previous-not-expired + `auth.communication.maxCount` within `auth.communication.windowHours`.                                                                |
| Token expiration      | Verification tokens (`auth.communication.expiry.minutes`). System tokens short-lived. `stayLoggedIn` extends system-token lifetime.                                                           |
| 2FA                   | **Per user only** (§19.15). Each user toggles TOTP in the profile page with human confirmation. There is no global 2FA toggle. Users can always use the verified-channel fallback (§19.15.3). |
| OAuth                 | Enabled implicitly by `auth.oauth.providers` — a non-empty JSON array lists the providers to show on login. Empty array = disabled (no separate flag).                                        |

#### 19.10 Tenant embedding in JWT

Every System API Token is a JWT with signed claims:

```typescript
{
  tenant: { systemId, companyId, systemSlug, roles, permissions },
  actorType: "user" | "api_token" | "connected_app",
  actorId: string,
  jti: string,                    // crypto.randomUUID()
  exchangeable: boolean,          // true only for user tokens
  exp: number,                    // unix seconds; absent when neverExpires=true
  iat: number
}
```

The backend reads this on every request. The frontend never parses the JWT body
beyond storing the opaque string.

#### 19.11 Token exchange — the only context-change path

Switching company/system in the ProfileMenu calls `POST /api/auth/exchange`:

```
POST /api/auth/exchange
Authorization: Bearer <current_token>
Body: { companyId: string; systemId: string }
Response: { success: true, data: { token: string, tenant: Tenant } }
```

Backend steps:

1. Verify JWT signature; check `revokedAt IS NONE` for its `jti` (rejects 401 if
   revoked/expired).
2. Load `claims.actorType` — **reject with 403 if not `"user"`.** App tokens and
   manually created tokens (`exchangeable: false`) are bound for life to their
   issue-time Tenant.
3. Verify the user still belongs to target `companyId` (via `company_user`) and
   is still associated with target `systemId` (via `user_company_system`). Fail
   → 403.
4. Load roles + permissions from that `user_company_system` row; resolve
   `systemSlug` from `systemId`.
5. Revoke the old token (`revokedAt = time::now()` on the `jti` record) — atomic
   with step 6 in the same batched query.
6. Issue a **new JWT** with the new Tenant and a fresh `jti`, using the
   remaining lifetime of the previous token (stay-logged-in semantics carry over
   but are not extended).
7. Return the new token.

**Frontend:** `useAuth` exposes `exchangeTenant(companyId, systemId)` which
performs the call, updates its internal `token` state, and triggers re-fetches
of menus, usage, billing, and any other context-dependent data. All components
read from `useAuth().token` only — no scattered companyId/systemId.

**API token + connected-app restriction.** Both return 403 from
`/api/auth/exchange`. They are scoped for life. The Tokens form and the OAuth
authorize page both state this explicitly.

##### 19.11.1 Superuser company-access bypass

When `claims.actorType = "user"` AND `claims.roles` contains `"superuser"`, the
exchange endpoint skips the normal company-user membership check (step 3) and
instead constructs the Tenant directly from the target `companyId` and
`systemId`. The resulting token carries `roles: ["admin"]` and
`permissions: ["*"]` for that (company, system) — granting full tenant access
without requiring a `company_user` or `user_company_system` row for the
superuser.

Backend steps (inserted between steps 2 and 3 when superuser):

1. Resolve `systemSlug` from the target `systemId` via Core cache.
2. Verify the target `companyId` and `systemId` exist and are associated (a
   `company_system` row exists).
3. Issue the new JWT with `roles: ["admin"]`, `permissions: ["*"]` — no
   `company_user` / `user_company_system` rows created.
4. The superuser can later switch between the company's systems via the normal
   ProfileMenu system selector (which reads available systems from
   `company_system`, not `user_company_system`).

This is the **sole mechanism** for a superuser to enter a tenant context. The
Companies page "Access" button (§20.7) is the UI entry point.

#### 19.12 Token revocation lifecycle

Revocation uses `jti` (not token hash), so it works for freshly minted user
tokens as well as persisted `api_token` / connected-app tokens.

- `api_token` records persist `jti` (see `0015_create_api_token`). Deleting a
  token from the Tokens page or revoking a connected app from the Connected Apps
  page sets `revokedAt = time::now()` in a single batched query. `withAuth`
  rejects any JWT whose `jti` maps to a row with `revokedAt IS NOT NONE`.
- **User-session JWTs** (login / exchange) use the `token_revocation` TTL table
  (§12.8). Exchange invalidates the prior session token by `jti`. Logout
  invalidates the current session token.
- **Deletion → revocation guarantee.** Any deletion of an `api_token` or
  `connected_app` sets `revokedAt` on the underlying `api_token` in the same
  batched query that removes the `connected_app` record. Rows stay for 90-day
  audit, then `server/jobs/token-cleanup.ts` hard-deletes them. Third parties
  who hold the raw bearer value cannot continue calling the API after the user
  revokes.

#### 19.13 Entity Channels

Every user and lead owns one or more `entity_channel` rows — the **single
mechanism** the platform uses to hold identity values (email, phone, …) and to
deliver communications. Channels double as the account-approval signal (§19.3)
and as the account-recovery entry points.

**Lifecycle:**

1. **Add (authenticated).** Adding a channel goes through
   `POST /api/entity-channels`. The channel is created with `verified = false`
   and a `verification_request` (actionKey `"auth.action.entityChannelAdd"`) is
   opened via `communicationGuard()`. A `send_communication` publish with
   `template = "human-confirmation"` is dispatched on the channel's own type
   first, falling back through the user's other verified channels if the new
   value cannot be reached (e.g. typo).
2. **Verify.** Clicking the confirmation link hits `POST /api/auth/verify`. The
   payload carries the `entity_channel` id(s) to flip to `verified = true`. The
   handler marks the request `usedAt` and updates the channel row(s) in a single
   batched query.
3. **Change / replace existing channel.** A verified channel's `value` cannot be
   mutated directly. Users replace it by adding the new value (which goes
   through the add+verify flow), then deleting the old row. Profile forms
   present this as "replace" for UX but the backend executes it as two atomic
   operations.
4. **Delete.** `DELETE /api/entity-channels` is permitted **only** when (a) the
   channel is unverified **or** (b) removing it leaves at least one other
   verified channel of a type listed in the subform's `requiredTypes`. Never
   marks a channel unverified in-place.
5. **Use for recovery.** `/account-recovery` submits any verified channel value;
   the backend path is described in §19.7 and always returns generic success to
   prevent enumeration.
6. **Resend confirmation.**
   `POST /api/entity-channels?action=resend-verification` re-sends the
   verification, subject to `communicationGuard()` (§12.13).

**Limits:**

- Maximum channels per owner: `auth.entityChannel.maxPerOwner` (default 10).
- Default types seeded at `auth.entityChannel.defaultTypes` (default
  `["email","phone"]`).
- Verification link expiry: `auth.communication.expiry.minutes` (default 15).
- Cooldown for resend: `communicationGuard()` (§12.13).

**Per-feature channel configuration.** Every system resource or action that uses
communication channels declares an **ordered vector of allowed channel types**.
The first channel that resolves a recipient and renders is used; the rest serve
as fallbacks (§15.9). System-wide fallback order comes from
`auth.communication.defaultChannels` when the caller does not provide its own.

**Management UI.** The ProfilePage renders an "Entity Channels" card via
`EntityChannelsSubform` (§18.5). The subform is shared across user and lead
profile editors. Props:

| Prop            | Type       | Meaning                                                                                          |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `channelTypes`  | `string[]` | Types presented in the add form. Order defines default display.                                  |
| `requiredTypes` | `string[]` | Types the owner must always have at least one verified row for (enforced server-side on delete). |

**Account recovery page.** `app/(auth)/account-recovery/page.tsx` —
unauthenticated page that accepts any verified channel value and drives the flow
described in §19.7.

#### 19.14 Password change (authenticated)

Authenticated users change their password from the ProfilePage, **not** via the
forgot-password flow. The endpoint is `POST /api/auth/password-change` with
`{ currentPassword, newPassword, confirmPassword }`.

1. Verify `currentPassword` with `crypto::argon2::compare()` against the user's
   stored `passwordHash`. Reject with `auth.error.invalidCredentials` on
   mismatch.
2. Validate `newPassword` via the `password` validator and require
   `newPassword === confirmPassword`.
3. Compute the new hash inside SurrealDB
   (`crypto::argon2::generate($newPassword)`) and open a `verification_request`
   (actionKey `"auth.action.passwordChange"`) via `communicationGuard()` with
   `payload = { newPasswordHash }`. **Only the hash is stored** — never the
   plaintext. Tenant context is captured on the request row.
4. Publish `send_communication` with `template = "human-confirmation"`. The
   channel order starts with the user's verified channel types ordered by
   `auth.communication.defaultChannels`. The confirmation link points at
   `/verify?token=…`.
5. `POST /api/auth/verify` for action `"auth.action.passwordChange"` writes
   `passwordHash = $payload.newPasswordHash` on the user row and marks the
   request `usedAt`, all in one batched query.

The new password never takes effect until the user clicks the confirmation link
— same as channel changes (§19.13).

#### 19.15 Two-factor authentication (user-level)

Two-factor authentication is **always a per-user decision**. There is no global
2FA toggle (the previously-documented `auth.twoFactor.enabled` setting has been
removed). Any user can enable or disable TOTP at any time from the ProfilePage;
the change only takes effect after the user clicks the human-confirmation link
sent through one of their verified channels. Users without a TOTP authenticator
app still get a second factor via the **verified-channel fallback** (§19.15.3) —
so losing the authenticator never locks the user out.

##### 19.15.1 Contract changes

`user.twoFactorEnabled` and `user.twoFactorSecret` remain the source of truth.
Only the **user themselves** (authenticated as actorType `"user"`) can flip the
flag; superusers impersonating a company (§19.11.1) MUST NOT mutate these fields
on the impersonated user's behalf.

**Encryption at rest.** TOTP shared secrets are sensitive data under §7.1.1.
`user.twoFactorSecret` and `user.pendingTwoFactorSecret` always store the
AES-256-GCM envelope produced by `encryptField()` (§12.15), never the raw base32
secret. Every write (setup-totp staging, verify-handler promotion) encrypts
first; every read (login TOTP verification) decrypts at the boundary and drops
the plaintext before the handler returns.

##### 19.15.2 Enable / disable flow

Endpoint: `POST /api/auth/two-factor`.

- **`action: "setup-totp"`.** Server generates a TOTP secret inside SurrealDB
  (never leaves the backend verbatim — the secret travels only through the
  verification_request payload, which is always server-side). Response:
  `{ provisioningUri, qrPayload }` (the URI the authenticator app consumes; the
  provisioning string does **not** include PII). The user scans the QR and
  submits the first TOTP code back to the same endpoint as
  `action: "confirm-totp"` with `{ code }`; the server verifies the code against
  the pending secret, then calls `communicationGuard()` with
  `actionKey = "auth.action.twoFactorEnable"` and
  `payload = { twoFactorSecret }`. The request publishes `send_communication`
  with `template = "human-confirmation"` across the user's verified channels
  (respecting `auth.communication.defaultChannels`). The actual flip of
  `twoFactorEnabled = true` + `twoFactorSecret = <secret>` happens in the verify
  handler when the user clicks the link.

- **`action: "disable"`.** No payload beyond the action. Server calls
  `communicationGuard()` with `actionKey = "auth.action.twoFactorDisable"` and
  an empty payload; the verify handler sets `twoFactorEnabled = false`,
  `twoFactorSecret = NONE` atomically when the link is clicked.

Rate limits and cooldowns use `communicationGuard()` (§12.13). Both actions
require `withAuth({ requireAuthenticated: true })`.

##### 19.15.3 Verified-channel fallback at login

`POST /api/auth/two-factor/login-link` is a dedicated, unauthenticated endpoint
that authenticates by `(identifier, password)`, not by a session token. It is
the recovery path for users who enabled TOTP but no longer have access to their
authenticator (or who simply prefer the channel path). Flow:

1. Rate-limit + bot-protection.
2. Resolve the user by verified channel + password (same primitives as §19.5
   steps 3–4). Reject with `auth.error.invalidCredentials` on failure.
3. Require `user.twoFactorEnabled = true`. If false, respond with a generic
   success (anti-enumeration); the normal login flow already handles this case.
4. `communicationGuard()` with `actionKey = "auth.action.loginFallback"` and
   `payload = { identifier, stayLoggedIn }`. No password or hash is ever placed
   in the payload — the verify handler re-authenticates by identifier on
   confirmation.
5. Publish `send_communication` with `template = "human-confirmation"` on the
   user's verified channels.

The confirmation link points at the same `/verify?token=…` page. The verify
handler recognizes `auth.action.loginFallback`, marks the request used, and
returns a fresh System API Token in the response (the verify page then stores
the token via `useAuth().login(...)`-equivalent logic and redirects to
`/entry`). Because the verification token is single-use and expiry-capped by
`auth.communication.expiry.minutes`, the link is as time-bound as a TOTP code.

##### 19.15.4 UI surface

- ProfilePage renders a "Two-Factor Authentication" card. When
  `twoFactorEnabled = false`, the card shows a primary button "Enable 2FA" which
  opens a modal: QR code (from `provisioningUri`), input for the first TOTP
  code, and a small paragraph explaining that a confirmation link will arrive
  after the code is submitted. When `twoFactorEnabled = true`, the card shows a
  "Disable 2FA" button with a confirmation dialog.
- Login page: when the backend returns `2FA_REQUIRED`, a second form appears
  with two options — "Enter code from your authenticator" (TOTP input) or "Send
  me a login link" (calls `/api/auth/two-factor/login-link`). The login link
  button remains available even when TOTP is configured, so the user always has
  both paths.

### 20. Superuser Core Admin Panel `(core)`

The `(core)` route group is superuser-only. Layout renders a sidebar with
hardcoded core menus: **Companies, Systems, Roles, Plans, Vouchers, Menus,
Terms, Data Deletion, Settings, Front Settings, File Access.** All sidebar
labels use i18n keys (never hardcoded English). Header text uses
`t("core.layout.superuserPanel")`.

#### 20.1 i18n keys

Core keys live in `src/i18n/{locale}/core.json`. The JSON omits the `core.`
domain prefix (the `t()` function strips it). Required groups:

- `nav.*` — sidebar labels (companies, systems, roles, plans, vouchers, menus,
  terms, dataDeletion, settings, frontSettings, fileAccess)
- `layout.*` — layout chrome (e.g. `layout.superuserPanel`)
- `systems.*` — CRUD keys: title, create, edit, name, slug, logo,
  termsOfService, empty
- `roles.*` — title, create, edit, name, system, selectSystem, permissions,
  permissionsHint, builtIn, isBuiltIn, empty
- `plans.*` — title, create, edit, name, description, system, selectSystem,
  price, cents, currency, recurrenceDays, benefits, benefitsHint, permissions,
  entityLimits, entityLimitsHint, apiRateLimit, storageLimitBytes, storage,
  maxConcurrentDownloads, maxConcurrentUploads, maxDownloadBandwidthMB,
  maxUploadBandwidthMB, maxOperationCount, maxOperationCountHint, active,
  inactive, isActive, days, empty
- `vouchers.*` — title, create, edit, code, priceModifier, cents,
  priceModifierHint, expiresAt, permissions, entityLimitModifiers,
  entityLimitModifiersHint, apiRateLimitModifier, storageLimitModifier,
  fileCacheLimitModifier, maxConcurrentDownloadsModifier,
  maxConcurrentUploadsModifier, maxDownloadBandwidthModifier,
  maxUploadBandwidthModifier, maxOperationCountModifier,
  maxOperationCountModifierHint, creditModifier, applicablePlanIds,
  applicablePlansHint, empty, expired, expires, apiRate, storage
- `menus.*` — title, selectSystem, label, emoji, componentName, sortOrder,
  requiredRoles, hiddenInPlanIds, edit, delete, addChild, addRoot,
  incompleteConfig, empty
- `settings.*` / `frontSettings.*` — title, key, value, description, save,
  missingTitle, addMissing, empty, add, saved, descriptionPlaceholder,
  scope.core, systemSelector.label
- `terms.*` — title, selectSystem, generic, genericHint, content, contentHint,
  save, saved, empty, noTerms, hasTerms, usingGeneric, editTerms, viewPublic
- `dataDeletion.*` — title, selectCompany, selectSystem, deleteButton, warning,
  awareness, passwordLabel, passwordPlaceholder, confirmDelete, success,
  error.passwordInvalid, error.notFound
- `companies.*` — title, empty, dateRange, systemFilter, planFilter,
  statusFilter, access, accessHint, systems, subscription, plan, status, active,
  cancelled, pastDue, noSubscription, chart, chartCanceled, chartPaid,
  chartProjected, chartErrors, revenueOverview
- `fileAccess.*` — title, create, edit, name, categoryPattern,
  categoryPatternHint, download, upload, isolateSystem, isolateCompany,
  isolateUser, permissions, permissionsHint, isolationHint, maxFileSizeMB,
  maxFileSizeMBHint, allowedExtensions, allowedExtensionsHint, empty,
  placeholder.name, placeholder.categoryPattern, placeholder.maxFileSizeMB,
  placeholder.allowedExtensions

Every key must have full `en` + `pt-BR` translations.

#### 20.2 Core form conventions

All entity forms (`SystemForm`, `RoleForm`, `PlanForm`, `VoucherForm`) use
`forwardRef` + `useImperativeHandle` to expose `getData()` + `isValid()`.

- **SystemForm** — name, slug, `FileUploadField` with `previewEnabled` for the
  system logo, `termsOfService` textarea (HTML). The `FileUploadField` uses
  `category={["logos"]}` and `systemSlug` from form state (slug must be filled
  before the upload is enabled). The upload route resolves `companyId` and
  `userId` from the tenant context (§13.2). System i18n key:
  `core.systems.termsOfService`.
- **RoleForm** — name, systemId (select), isBuiltIn (checkbox),
  `MultiBadgeField` for permissions (`mode:"custom"`, format hint
  `"e.g. core.users.read, core.billing.write"`).
- **PlanForm** — name, description, systemId, price, currency, recurrenceDays,
  apiRateLimit, storageLimitBytes, fileCacheLimitBytes, maxConcurrentDownloads,
  maxConcurrentUploads, maxDownloadBandwidthMB, maxUploadBandwidthMB,
  maxOperationCount, isActive. `MultiBadgeField mode:"custom"` for permissions,
  `MultiBadgeField
  mode:"custom"` for benefits, `DynamicKeyValueField` for
  entityLimits, `DynamicKeyValueField` for maxOperationCount (per-resourceKey
  map, same pattern as entityLimits).
- **VoucherForm** — code, priceModifier, apiRateLimitModifier,
  storageLimitModifier, fileCacheLimitModifier, maxConcurrentDownloadsModifier,
  maxConcurrentUploadsModifier, maxDownloadBandwidthModifier,
  maxUploadBandwidthModifier, maxOperationCountModifier,
  maxOperationCountModifierHint, creditModifier, expiresAt.
  `MultiBadgeField mode:"custom"` for permissions; `DynamicKeyValueField` for
  entityLimitModifiers; `DynamicKeyValueField` for maxOperationCountModifier
  (per-resourceKey map); `SearchableSelectField(multiple={true})` for
  `applicablePlanIds` fetching `/api/core/plans?search=` (empty selection =
  valid for all plans). Removing a plan from `applicablePlanIds` on save
  triggers the auto-removal cascade (§22.7) so subscriptions that no longer
  qualify are stripped of the voucher atomically with the update.

#### 20.3 `MenuTreeEditor` (`src/components/core/MenuTreeEditor.tsx`)

Not a standard list page — a dedicated tree editor.

1. **System selector** at the top — dropdown. Only menus for the selected system
   are shown. Changing the system reloads the tree.
2. **Tree display** with indentation, emoji + label per node, e.g.:
   ```
   📈 Usage
   📁 Reports
   ├── 📈 Sales Report
   ├── 📉 Analytics
   │   └── 📊 Deep Dive
   ```
3. **Inline "+" add.** A "+" button at root level and one inside each node (to
   add a child). Clicking "+" replaces the "+" with an inline text input (with
   cancel), asking only for the menu label. Enter creates the menu with just the
   label (+ parent + system). **No modal for creation.**
4. **Incomplete-config badge.** "⚠" displayed when a menu item is missing
   required configuration (e.g. empty `componentName`). Structural menus that
   only group submenus are expected to have no `componentName` and are not
   flagged.
5. **Edit button** "✏️" opens a modal to edit everything **except hierarchy**:
   label, emoji, componentName, sortOrder, requiredRoles (`MultiBadgeField`),
   hiddenInPlanIds (`MultiBadgeField`). Parent-child relationships are managed
   exclusively via drag-and-drop.
6. **Delete button** "🗑️" with confirmation.
7. **Drag-and-drop.** Reorder within the same level (updates `sortOrder`), or
   move to another parent (updates `parentId`). Optimistic tree; persisted via
   API.
8. **No top-level search or create button.** All additions go through the inline
   "+" buttons.

#### 20.4 `SettingsEditor` / `FrontSettingsEditor`

Both pages use `DynamicKeyValueField` + a "missing keys" banner with an "Add all
missing" button. A badge in each header identifies which table is being edited
(§10.2.7). Missing-settings data comes from `/api/core/settings/missing` and
`/api/core/front-settings/missing` respectively.

#### 20.5 `TermsEditor` (`app/(core)/terms/page.tsx` + `src/components/core/TermsEditor.tsx`)

Core sidebar entry: 📜 `core.nav.terms`. Separate from the System edit form.

1. **Generic terms card** at the top (always visible): edits the `terms.generic`
   core setting via a modal with a large textarea.
2. **System terms list** below: each system card shows name + slug + a status
   badge (`core.terms.hasTerms` or `core.terms.usingGeneric`) + an edit button
   opening a modal with a pre-filled searchable system field (read-only in edit
   mode) + a very large textarea.
3. **Create button**: opens a modal with a searchable system field (same
   debounced-dropdown pattern as `DataDeletion`) + a large textarea. Saving
   updates that system's `termsOfService`.

API: `GET /api/core/terms` returns all systems with their terms status.
`PUT /api/core/terms` accepts `{ systemId, termsOfService }` to update a system,
or `{ generic: true, content }` to update the generic fallback setting.

#### 20.6 `DataDeletion` (`app/(core)/data-deletion/page.tsx` + `src/components/core/DataDeletion.tsx`)

Sidebar entry lives under `core.nav.dataDeletion`. Permanently deletes all data
for a specific (company, system) pair, including uploaded files.

**Page:** debounced `SearchField` to pick company + debounced `SearchField` to
pick system. Delete button enabled only when both are selected; opens the
confirmation modal.

**Confirmation modal (high-security):**

1. Red warning: irreversible; lists every table affected (§20.6.1).
2. **Awareness checkbox** (`core.dataDeletion.awareness`) must be checked.
3. **Password re-entry** — superuser re-enters their current password. Sent to
   backend and verified via `crypto::argon2::compare()` before any deletion
   occurs.
4. Delete button enabled only when awareness is checked + password non-empty.
   Spinner during the op.
5. Cancel closes without action.

**API:** `DELETE /api/core/data-deletion`
`Body: { companyId, systemId, password }`.

- `withAuth({ roles: ["superuser"] })`.
- Fetch superuser's `passwordHash`; argon2-compare.
- On failure → 403.
- On success → run the scoped deletion (§20.6.1).

##### 20.6.1 Deletion scope (single batched query, `server/db/queries/data-deletion.ts`)

Removes, for the given (`companyId`, `systemId`) pair:

- `company_system` association
- `user_company_system` rows
- `subscription` rows
- `lead_company_system` rows
- `usage_record` rows
- `connected_app` rows
- `api_token` rows
- `credit_purchase` rows
- `tag` rows
- `menu_item` rows for this system (only if no other companies use it)
- All uploaded files under `{companyId}/{systemSlug}/` via `fs.delete()`
  iterating `fs.readDir()`.

**Does NOT delete** the `company` or `system` records themselves — only the
association and all scoped data. The entities can be re-associated later.

#### 20.7 `CompaniesPage` (`app/(core)/companies/page.tsx` + `src/components/core/CompaniesPage.tsx`)

Sidebar entry: 🏢 `core.nav.companies`. Read-only overview of all registered
companies with their subscribed systems, subscription plans, and an **Access**
button for superuser impersonation.

**Company list.** Uses `GenericList` with `renderItem` for the company card,
`controlButtons: []`, and a single `actionComponent` for the Access button that
receives the full `Company` item data. Cursor-based pagination (§7.1) via
`fetchFn` calling `GET /api/core/companies`. Search-enabled (debounced).

Each company card (`renderItem`) shows:

- Company name and document.
- **Subscribed systems** list — each system row shows the system name, the
  subscription's plan name, and a status badge (`active` / `past_due` /
  `cancelled` / `core.companies.noSubscription`).
- **Access** `actionComponent` — calls `POST /api/auth/exchange` with superuser
  bypass (§19.11.1) targeting the company's first subscribed system with
  `roles: ["admin"]` and `permissions: ["*"]`. On success, the frontend stores
  the new token and redirects to `/entry` so the `(app)` layout loads the tenant
  context. The superuser can then switch between the company's systems via the
  normal ProfileMenu system selector.

**Filters** (outside GenericList, in the page header):

1. **Date range** — `DateRangeFilter` with `maxRangeDays = 31`. Constrains the
   chart to the selected period only (does **not** filter the company list).
   Passed as `startDate`/`endDate` query params to the chart endpoint only.
2. **System filter** — `MultiBadgeField mode:"search"` with `fetchFn` calling
   `GET /api/core/systems?search=`. Passed as `systemIds` query param to both
   the company list and the chart.
3. **Plan filter** — `MultiBadgeField mode:"search"` with `fetchFn` calling
   `GET /api/core/plans?search=`. Passed as `planIds` query param to both the
   company list and the chart.
4. **Payment-status filter** — `MultiBadgeField mode:"search"` with
   `staticOptions` containing three values: `active` ("Payments up-to-date"),
   `cancelled` ("Cancelled payments"), `past_due` ("Payments with errors").
   Passed as `statuses` query param to both the company list and the chart. When
   empty, all companies are shown.

**Company list search.** `GenericList` provides debounced search via
`searchEnabled`. The `search` param performs FULLTEXT lookup on company `name`
(`name @@ $search`). All filters except date range (system, plan, status) apply
to the list.

**Revenue chart.** `react-chartjs-2` `Bar` chart with four grouped columns
within the selected date range. Subject to **all** filters (date range, system,
plan, status). Data fetched from
`GET /api/core/companies?action=chart&startDate=…&endDate=…&planIds=…&systemIds=…&statuses=…`:

1. **Canceled revenue** — sum of `subscription` amounts where
   `status =
   "cancelled"` and the cancellation timestamp falls within the
   interval. Color: red tones.
2. **Paid revenue** — sum of subscription amounts where `status = "active"` and
   `currentPeriodStart` falls within the interval (successfully renewed or newly
   subscribed). Color: `--color-primary-green`.
3. **Projected revenue** — sum of subscription amounts where
   `status =
   "active"` and `currentPeriodEnd` falls within the interval
   (expected renewal). Color: `--color-secondary-blue`.
4. **Errors revenue** — sum of `subscription` amounts where
   `status =
   "past_due"` and the `updatedAt` timestamp falls within the
   interval (failed payment attempts). Color: yellow/amber tones.

Gradient header: `core.companies.revenueOverview`. Values formatted as currency.
Chart renders inside a glassmorphism card following the visual standard.

**API:**

```
GET /api/core/companies
  ?search=…&cursor=…&limit=20
  &systemIds=id1,id2&planIds=id1,id2&statuses=active,cancelled,past_due

GET /api/core/companies?action=chart
  &startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  &systemIds=id1,id2&planIds=id1,id2&statuses=active,cancelled,past_due
```

Paginated list response (standard `PaginatedResult` shape):

```typescript
// GET without action=chart
{
  success: true,
  data: Array<{
    id: string;
    name: string;
    document: string;
    createdAt: string;
    systems: Array<{
      systemId: string;
      systemName: string;
      systemSlug: string;
      subscriptionId: string | null;
      planName: string | null;
      planPrice: number;
      status: "active" | "past_due" | "cancelled" | null;
    }>;
  }>;
  nextCursor: string | null;
}

// GET with action=chart
{
  success: true,
  data: {
    canceled: number;   // cents
    paid: number;       // cents
    projected: number;  // cents
    errors: number;     // cents
  };
}
```

`withAuth({ roles: ["superuser"] })`. The list query uses `paginatedQuery`
(§7.1) on the `company` table; company_systems + subscriptions are resolved in a
single batched `db.query()` (§7.2) using lookup maps. Chart aggregates computed
in a separate dedicated query.

### 21. Subsystem Panel `(app)`

The authenticated user's workspace, scoped to a specific company + system.
Layout behavior is in §18.8.

#### 21.1 `UsersPage` (admin CRUD — `src/components/shared/UsersPage.tsx`)

Lists users associated with the current company + system. Create/edit/delete
visible only to users whose `useSystemContext().roles` contains `admin`.

**Invite flow** (`POST /api/users`):

- **New user** (no existing email): creates `user` with profile, hashes
  password, creates `company_user` + `user_company_system` with the specified
  roles.
- **Existing user** (matched by any submitted channel value): **does not create
  a new account.** Creates or updates `company_user` + `user_company_system` for
  the target (company, system), setting the specified roles. Returns
  `{ success: true, invited: true }`. Frontend shows
  `common.users.inviteExisting`. Backend publishes `send_communication` with
  `template = "notification"` and `eventKey = "auth.event.tenantInvite"`
  (inviter name, company, system, roles) — **this notification is mandatory**.

**Roles are per (company, system) pair.** Stored in `user_company_system`. Same
user can have different roles in different systems. `DELETE /api/users` only
removes the `user_company_system` association — never the `user` record or other
associations.

**Admin invariant (no tenant without an admin).** Every (company, system) pair
must have at least one user with the `admin` role in `user_company_system`. The
backend enforces this on two operations:

1. **Role update** (`PUT /api/users` with `roles`): if the new roles array does
   not contain `"admin"`, the server counts how many other users hold the
   `admin` role for the same (companyId, systemId). If the count is zero, the
   request is rejected with
   `{ code: "VALIDATION", errors: ["users.error.lastAdminRole"] }`.
2. **User removal** (`DELETE /api/users`): if the target user holds the `admin`
   role for the (companyId, systemId), the server counts how many other admins
   remain. If the target is the sole admin, the request is rejected with
   `{ code: "VALIDATION", errors: ["users.error.lastAdminDelete"] }`.

Both checks are performed in the same batched `db.query()` as the mutation — a
`SELECT count()` of admins precedes the conditional update/delete via
`IF … ELSE` branching, ensuring atomicity under concurrency (§7.2).

The company owner who creates the subscription always receives
`roles: ["admin"]` (§22.1), guaranteeing the invariant starts satisfied.
Superuser operations (core admin panel) bypass this check — they operate outside
the tenant scope.

**Features:**

- Debounced search (already present).
- **Create / Invite** modal: name, email, phone, password,
  `MultiBadgeField mode:"search"` for roles fetching
  `/api/core/roles?systemId=...`. Hint explains the invite flow. `password`
  silently ignored when inviting an existing user.
- **Edit** modal (fields): name (via profile), phone, roles. Email read-only.
  `PUT /api/users`.
- **Delete** with confirmation → `DELETE /api/users`.
- **Role badges** per row from `user_company_system`.

#### 21.2 `TokensPage` (`src/components/shared/TokensPage.tsx`)

Lists API tokens for the current (user, company, system). Every token here
carries the Tenant of that (company, system) and is **not exchangeable**
(§19.11).

**Create modal:**

- Name, description.
- `MultiBadgeField mode:"search"` for permissions, fetching unique permissions
  aggregated from all roles for the current system via
  `/api/core/roles?systemId=...`.
- Optional `monthlySpendLimit`.
- `DynamicKeyValueField` for `maxOperationCount` (per-resourceKey operation
  count cap — same pattern as plan's `maxOperationCount`).
- Expiry section — mutually exclusive: **"Never expires"** checkbox OR
  `expiresAt` date input. Checking "Never expires" disables the date; setting a
  date unchecks the box.
- **"Use in frontend" toggle.** When on, a required `frontendDomains`
  `MultiBadgeField mode:"custom"` (hint `"e.g. https://app.example.com"`)
  appears.
- Backend re-validates: `neverExpires` XOR `expiresAt`; `frontendUse` implies ≥
  1 frontend domain.
- **On success, a modal displays the raw token once** with a copy button and a
  warning that it cannot be shown again.

**Delete token** — `DeleteButton` on each row with confirmation. Calls
`DELETE /api/tokens` which sets `revokedAt` on the `api_token` row (§19.12),
invalidating the token instantly regardless of copies.

**Token list.** Each card shows: name, description, permission badges, expiry
date or a "Never expires" badge, a "Frontend" badge with the domain count when
`frontendUse = true`, creation date.

##### 21.2.1 `ApiToken` contract (rules-bearing)

```typescript
export interface ApiToken {
  id: string;
  userId: string;
  tenant: Tenant; // source of truth for scope (§9)
  companyId: string; // mirrors tenant.companyId — denormalized for indexing
  systemId: string; // mirrors tenant.systemId — denormalized for indexing
  name: string;
  description?: string;
  tokenHash: string; // stored hashed; raw shown once
  jti: string; // unique — used for revocation (§19.12)
  permissions: string[]; // duplicated into tenant.permissions at issue time
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  neverExpires: boolean; // mutually exclusive with expiresAt
  expiresAt?: string; // null when neverExpires is true
  frontendUse: boolean; // allowed from browsers (CORS §12.7)
  frontendDomains: string[]; // allowed origins when frontendUse=true (empty = block all)
  revokedAt?: string; // §19.12
  createdAt: string;
}
```

#### 21.3 `ConnectedAppsPage` (`src/components/shared/ConnectedAppsPage.tsx`)

- Shows all `connected_app` records for the current (company, system).
- **No manual "Add" button.** Apps are created exclusively via the OAuth flow
  (§24).
- Each card shows: app name, granted permissions, creation date, and a
  **Revoke** button → `DELETE /api/connected-apps` which deletes the
  `connected_app` row AND sets `revokedAt = time::now()` on the underlying
  `api_token` in the same batched query (§19.12). Raw hash retained 90 days for
  audit; cleanup job deletes after.
- An info box explains the OAuth flow and shows the authorization URL template
  for developer reference.

#### 21.4 `BillingPage` (`src/components/shared/BillingPage.tsx`)

Organized into sections.

**1. Current Plan.** Renders the active subscription's plan card (§18.10) with a
"Current Plan" badge. Shows next billing date (`currentPeriodEnd`). **Cancel**
button → confirmation modal → `POST /api/billing { action: "cancel" }`. If no
active subscription, shows a prompt to subscribe.

**2. Available Plans.** All active plans for the current system as rich plan
cards. Each non-current plan has a **Subscribe** button. Paid plans that lack a
payment method prompt the user to add one first, then call
`POST /api/billing { action: "subscribe" }`. Plan changes: the backend cancels
the old subscription and creates a new one in the same batched query.

**3. Payment Methods.** Lists all for the current company. Each card shows
mask + holder name + "Default" badge when applicable.

- **Add** → `FormModal` with `CreditCardSubform` (embeds `AddressSubform`).
  `POST /api/billing { action: "add_payment_method" }`.
- **Set Default** on any non-default card →
  `POST /api/billing { action: "set_default_payment_method" }`.
- **Remove** (confirmation) →
  `POST /api/billing { action: "remove_payment_method" }`.

**4. Credits.**

- Current balance for the (company, system).
- **Operation Count** display: per-resourceKey breakdown for the current period
  (from `subscription.remainingOperationCount` map). Each entry shows remaining
  vs. plan cap (e.g. "850 / 1,000 face detections"). Translated via
  `t("billing.limits." + key)`. Absent key or `0` cap renders
  `t("billing.limits.unlimited")`.
- **Purchase Credits** form: amount + payment method →
  `POST /api/billing { action: "purchase_credits" }`.
- **Credit History** list with status badges.
- **Auto-Recharge Credits** subsection: toggle
  (`billing.credits.autoRecharge.title`) with description
  (`billing.credits.autoRecharge.description`). When enabled, an amount input in
  the subscription currency (`billing.credits.autoRecharge.amountLabel`) becomes
  required. Disabling resets `autoRechargeAmount` to 0. Tooltip: auto-recharge
  requires a default payment method; if none exists, the toggle is disabled with
  a hint linking to Payment Methods. Saving calls
  `POST /api/billing { action: "set_auto_recharge", enabled, amount }`.

**5. Voucher.**

- Input + Apply button → `POST /api/billing { action: "apply_voucher" }`.
  Backend validates (exists, not expired, company in `applicableCompanyIds` — or
  that array is empty, current plan in `applicablePlanIds` — or that array is
  empty) and sets `subscription.voucherId` (§22.7 — single-voucher invariant:
  applying replaces any existing voucher).
- **Feedback appears inline directly below the voucher input, not at the top of
  the page.** Per-section state (no global `setError`/`setSuccess`).
  `billing.voucher.success` (green) or error (red). On success the input clears
  and the subscription reloads.
- Displays the currently applied (non-expired) voucher — if any — as a single
  badge showing code + price effect (e.g. `−$5.00` or `+$2.00`). If the voucher
  has `creditModifier != 0`, a secondary badge shows the credit effect (e.g.
  `+500 credits` or `−200 credits`, signed modifier). Non-zero transfer or
  operation-count modifiers shown as secondary badges (e.g. `+2 downloads`).
  Per-resourceKey `maxOperationCountModifier` entries shown as separate badges
  (e.g. `+100 faceDetection`). Applying a new voucher replaces the badge
  automatically.
- Effective price display: `GET /api/billing` returns subscriptions with
  `voucherId` **FETCHed** (full voucher object, or `NONE`). See §18.10 for the
  price rendering rule.

**6. Payment Error & Retry.** When the active subscription has
`status =
"past_due"`, display an error badge (`billing.paymentStatus.pastDue`)
with a description (`billing.paymentStatus.pastDueDescription`) and a **Process
again** button (`billing.paymentStatus.retry`) that calls
`POST /api/billing { action: "retry_payment" }`. The subscription's
`retryPaymentInProgress` field is the re-entrancy guard:

- `true` → show a "Processing" badge (`billing.paymentStatus.processing`),
  disable the retry button, show `<Spinner />`.
- `false` → enable the retry button. The Current Plan section renders for both
  `active` and `past_due` subscriptions (using
  `displaySub = activeSub ?? pastDueSub`).

**7. Payment History.** `GenericList` with `searchEnabled={false}`,
`createEnabled={false}`, `controlButtons={[]}`. Each row shows: date
(`createdAt`), amount (formatted currency), kind badge (recurring / credits /
auto-recharge — i18n keys `billing.paymentHistory.kind.*`), status badge
(`billing.paymentHistory.status.*`), and invoice URL. When `invoiceUrl` is
non-empty, render as a link (`billing.paymentHistory.viewInvoice`). When empty
or undefined, render `billing.paymentHistory.invoiceNotAvailable` in secondary
text. A `DateRangeFilter` with `maxRangeDays = 365` sits above the list; date
values are passed to the `fetchFn` as `startDate`/`endDate` query params on
`GET /api/billing?include=payments&startDate=…&endDate=…`.

#### 21.5 `UsagePage` (`src/components/shared/UsagePage.tsx`)

Dual-mode usage dashboard. Accepts `mode?: "tenant" | "core"` (default
`"tenant"`). Same component, same API route (`/api/usage`), different rendering
based on mode.

**Tenant mode** (`mode="tenant"`). Fetches
`GET /api/usage?companyId&systemId&startDate&endDate`.

**1. Storage.** Horizontal `react-chartjs-2` `Bar` showing used vs. available
storage (plan limit + voucher `storageLimitModifier`). Storage usage is computed
server-side via `@hviana/surreal-fs` `fs.readDir()` summing file sizes under
`{companyId}/{systemSlug}/`. The backend query (`server/db/queries/usage.ts`)
caches this and recalculates periodically or on upload/delete. Values in
human-readable format (e.g. `"245 MB /
1 GB"`). Gradient fill
`from-[var(--color-primary-green)] to-[var(--color-secondary-blue)]`.

**2. File Cache.** Horizontal bar chart showing used vs. available cache
capacity (plan `fileCacheLimitBytes` + voucher `fileCacheLimitModifier`). Data
from `FileCacheManager.getStats()` (§12.12). Same visual pattern as Storage.
Emoji 🗂️.

**3. Credit Expenses.** `react-chartjs-2` `Bar` column chart: one column per
**resource key** (translated via `t()`), value = sum of daily `credit_expense`
records over the selected range. Each expense tracks both `totalAmount` (cents
consumed) and `totalCount` (number of individual operations).
**`DateRangeFilter` with `maxRangeDays = 31`.** Default range: last 31 days.
Distinct color per resource. Summary table below showing amount, count, and
average cost per operation.

**No "API Calls" metric.** Rate limiting is enforced by middleware (not tracked
as usage).

**4. Operation Count.** Per-resourceKey bar chart. Each resourceKey from the
plan's `maxOperationCount` map gets its own horizontal bar showing consumed vs.
available for the current subscription period. Consumed is
`planMax − subscription.remainingOperationCount[key]` (when cap > 0). Data comes
from the subscription (§22.6). Emoji 🔢. Each key rendered with translated label
via `t("billing.limits." + key)`. Value of `0` cap or absent key renders
`t("billing.limits.unlimited")`.

**Usage API:**

```
GET /api/usage?companyId&systemId&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

```typescript
{
  success: true,
  data: {
    storage: { usedBytes: number; limitBytes: number /* plan + vouchers */ };
    cache: { usedBytes: number; maxBytes: number; fileCount: number };
    creditExpenses: { resourceKey: string; totalAmount: number; totalCount: number }[];
    operationCount: { resourceKey: string; used: number; max: number /* 0 = unlimited */ }[];
  }
}
```

**Core mode** (`mode="core"`). Superuser-only. Fetches
`GET /api/usage?mode=core&startDate&endDate&companyIds&systemIds&planIds&actorIds`.
Backend validates `superuser` role; non-superusers receive 403.

- **Filter bar** with six `MultiBadgeField mode="search"` filters: companies,
  systems, plans, tokens, connected apps, users. Company/system/plan filters
  narrow the cross-tenant aggregation. Token/connected-app/user filters merge
  into a single `actorIds` param (matched against `credit_expense.actorId`).
- **Dual-axis stacked bar chart:** amount (cents/100, green, left Y-axis) and
  count (blue, right Y-axis). Clicking a column sets `clickedResourceKey` state.
- **Badges:** total spending (always visible) and average spending per operation
  (visible when a column is clicked).
- **Summary table** below chart: resource, count, average cost, total amount.

### 22. Billing & Credits

#### 22.1 `POST /api/billing` actions

All actions accept `action` in the body. Every billing mutation calls
`Core.getInstance().reloadSubscription(companyId, systemId)` after the DB write
to keep the subscription cache (§10.1, backed by §12.11) in sync.

**`subscribe`** — create a new subscription (or change plan):

1. Create `company_system` **idempotently** via an existence check
   (`IF array::len(...) = 0 { CREATE company_system ... }`). SurrealDB throws on
   `CREATE` with a duplicate unique key, so a raw `CREATE` must **never** be
   used here.
2. If an active subscription already exists for this (company, system), update
   it to `status = "cancelled"` in the same batched query.
3. Create `subscription` with selected plan, period dates, status `"active"`,
   `remainingPlanCredits = plan.planCredits`, and `remainingOperationCount` set
   to the full per-resourceKey map from `resolveAllOperationCounts()` (plan
   keys + voucher modifier keys, 0 or absent = unlimited for that key).
4. Create `user_company_system` if missing for the authenticated user + this
   (company, system), with `roles: ["admin"]`. This ensures the company owner
   always sees "Manage Users" and can perform admin operations.

Free plans (price = 0) omit `paymentMethodId` (field is
`option<record<payment_method>>`). Paid plans require it; the route returns a
validation error if missing.

**`cancel`** — body: `{ action: "cancel", companyId, systemId }`. Sets
subscription `status = "cancelled"`. **Does NOT delete the `company_system`
association.**

**`add_payment_method`** — body:
`{ action, companyId, cardToken,
cardMask, holderName, holderDocument, billingAddress }`.
Creates `address` record first, then `payment_method` with the link. First
method for the company → `isDefault = true`.

**`set_default_payment_method`** — body:
`{ action, companyId,
paymentMethodId }`. Sets `isDefault = false` for all the
company's methods, then `isDefault = true` on the target. Single batched query.

**`remove_payment_method`** — body: `{ action, paymentMethodId }`. Deletes the
`payment_method` and its linked `address`. If removed method was default,
promotes the next available.

**`purchase_credits`** — body:
`{ action, companyId, systemId, amount,
paymentMethodId }`. Creates
`credit_purchase` `status = "pending"`; publishes `payment_due`;
`process_payment` charges + updates status. On success: increments credit
balance via `usage_record resource =
"credits"` and publishes `send_email` with
`payment-success` (`kind =
"credits"`); **also resets
`subscription.creditAlertSent = false`**. On failure: `send_email` with
`payment-failure` (`kind = "credits"`, with gateway `reason`).

**`set_auto_recharge`** — body:
`{ action, companyId, systemId, enabled,
amount }`. When enabling: `amount` must
be ≥ `billing.autoRecharge.minAmount` (default 500 ¢), else
`validation.amount.tooSmall`; company must have a default `payment_method`, else
`billing.autoRecharge.noDefaultPaymentMethod`. Updates `autoRechargeEnabled` +
`autoRechargeAmount` in a single batched query. Disabling sets
`autoRechargeAmount = 0` AND resets `autoRechargeInProgress = false` to clear
any stuck flag.

**`apply_voucher`** — body: `{ action, companyId, systemId, voucherCode }`.
Validates in order: voucher exists; not expired; the company is in
`applicableCompanyIds` (or the array is empty = universal); the subscription's
current `planId` is in `applicablePlanIds` (or that array is empty = all plans).
Sets `subscription.voucherId` — single-voucher invariant: if the subscription
already has a voucher, it is replaced atomically in the same batched query
(§22.7). If the voucher has `creditModifier != 0`, adjusts
`subscription.remainingPlanCredits` by that signed amount in the same batched
query. If the voucher's `maxOperationCountModifier` has any non-zero keys,
adjusts each corresponding key in `subscription.remainingOperationCount`
(per-resourceKey delta, clamped to ≥ 0) in the same batched query. Returns the
applied voucher's details so the frontend can show the effect.

**`retry_payment`** — body: `{ action }`. Finds the `past_due` subscription for
the tenant. Returns 404 (`billing.retry.noPastDue`) if none. Returns 409
(`billing.retry.inProgress`) if `retryPaymentInProgress = true`. Sets
`retryPaymentInProgress = true` in a batched query, publishes `payment_due` with
`purpose = "retry"`. The `process_payment` handler charges the subscription's
payment method. On success: restores `status = "active"`, advances period,
resets credits, clears `retryPaymentInProgress`. On failure: keeps
`status = "past_due"`, clears `retryPaymentInProgress`. The re-entrancy guard
prevents the user from requesting payment processing twice.

**Payment record creation.** Every invocation of `process_payment` creates a
`payment` record (§8, migration `0038`) with `status = "pending"` before
charging. On success: updates to `status = "completed"` with `transactionId` and
`invoiceUrl` from the provider result. On failure: updates to
`status = "failed"` with `failureReason`.

#### 22.2 Spend limits

Users, tokens, and connected apps may define `monthlySpendLimit`. Before any
chargeable operation, the system checks that the actor's current month usage +
operation cost ≤ `monthlySpendLimit`.

#### 22.3 Credit deduction system

Credits consumed by system-specific operations identified by i18n resource keys.
Each plan includes `planCredits` — temporary credits valid only during the
plan's recurrence period. On subscribe or renew, `remainingPlanCredits` is set
to `plan.planCredits + voucher.creditModifier` (the voucher modifier is 0 when
no voucher is active; negative values decrease credits); these expire when the
period ends.

**Priority (handled by `consumeCredits` in `credit-tracker.ts`):**

1. Plan credits first — decrement `subscription.remainingPlanCredits`.
2. Purchased credits second — decrement from `usage_record resource = "credits"`
   balance.
3. Insufficient → operation rejected; email alert triggered (once per exhaustion
   cycle).

**Algorithm (all in one batched `db.query()`):**

1. Fetch the active subscription for the (company, system).
2. Fetch the company's purchased credit balance.
3. `total = remainingPlanCredits + purchased`.
4. **Operation-count cap check (per-resourceKey):** look up
   `remainingForThisKey = subscription.remainingOperationCount[resourceKey]`.
   Resolve the effective cap via
   `resolveMaxOperationCount({ ..., resourceKey })`. If the cap is non-zero and
   `remainingForThisKey` is `0`, reject with
   `{ success: false, source: "operationLimit" }` — no alert or auto-recharge.
   If `operationCountAlertSent[resourceKey]` is falsy, publish
   `send_communication` with `template = "notification"` and
   `eventKey = "billing.event.operationCountAlert"`, and set
   `operationCountAlertSent[resourceKey] = true`. 4a. **Actor-level cap check:**
   when `tenant.actorType` is `"api_token"` or `"connected_app"`, resolve the
   actor's `maxOperationCount[resourceKey]` from the `api_token` or
   `connected_app` record. If non-zero, count the actor's `credit_expense`
   entries (matching `actorId`) for this `resourceKey` in the current billing
   period. If the count >= the actor's cap for this key, reject with
   `{ success: false, source: "operationLimit" }`.
5. If `total < amount`:
   - If `autoRechargeEnabled = true` AND `autoRechargeInProgress = false`: set
     `autoRechargeInProgress = true` (re-entrancy guard) and publish
     `trigger_auto_recharge { subscriptionId, companyId, systemId,
     resourceKey }`.
     Return `{ success: false, source: "insufficient" }`. Caller retries after
     the recharge completes; retry policy is system-specific (most resources
     fail the current op and let the user retry).
   - Else (disabled or already in progress):
     - If `creditAlertSent = false`: publish `send_communication` with
       `template = "notification"` and
       `eventKey = "billing.event.insufficientCredit"`, and set
       `creditAlertSent = true`.
     - Return `{ success: false, source: "insufficient" }`.
6. If `remainingPlanCredits >= amount`: decrement it; record the expense in
   `credit_expense` (daily container, UPSERT increments both `amount` and
   `count`, includes `actorId`). If `remainingOperationCount[resourceKey] > 0`,
   decrement that key by 1 in the same batch. Return
   `{ success: true, source: "plan" }`.
7. Else `total >= amount`: use all plan credits, decrement remainder from
   purchased; record the expense in `credit_expense` (UPSERT increments both
   `amount` and `count`, includes `actorId`). If
   `remainingOperationCount[resourceKey] > 0`, decrement that key by 1 in the
   same batch. Return `{ success: true, source: "purchased" }`.

**One-shot alert mechanisms.** Two independent alert flags:

**`creditAlertSent`** resets to `false` in two scenarios — ensuring the user is
notified each time credits run out after a replenishment, without spam:

1. **Credit purchase** — `purchase_credits` success (§22.1) resets the flag on
   the active subscription.
2. **Plan renewal** — the recurring-billing job resets it when renewing
   (alongside
   `remainingPlanCredits = plan.planCredits + voucher.creditModifier`).

**`operationCountAlertSent`** (per-resourceKey map) resets to `{}` (empty map)
in two scenarios:

1. **Plan renewal** — the recurring-billing job resets it when renewing
   (alongside `remainingOperationCount = resolveAllOperationCounts()`).
2. **Voucher application** — `apply_voucher` resets the specific key when the
   voucher's `maxOperationCountModifier` for that key increases the remaining
   count above 0.

#### 22.4 Plan-credit and operation-count lifecycle

- **On subscribe:** `remainingPlanCredits = plan.planCredits`.
  `remainingOperationCount = resolveAllOperationCounts()` (full per-resourceKey
  map from plan + voucher).
- **On renewal** (recurring-billing job):
  `remainingPlanCredits =
  plan.planCredits + voucher.creditModifier` (0 when
  no voucher); `remainingOperationCount = resolveAllOperationCounts()` (reset);
  `creditAlertSent = false`; `operationCountAlertSent = {}` (empty map).
- **On cancel:** plan credits are forfeited (not refunded);
  `remainingPlanCredits` stays as-is on the cancelled row for audit.
  `remainingOperationCount` map stays as-is for audit.
- **On plan change** (subscribe to a different plan): old subscription cancelled
  (credits forfeited); new subscription starts with the new plan's `planCredits`
  and fresh `remainingOperationCount` map.

#### 22.5 Auto-recharge credits

When a deduction fails and `autoRechargeEnabled = true`, the credit tracker
publishes `trigger_auto_recharge` instead of immediately sending the
insufficient-credit email. The `auto_recharge` handler
(`server/event-queue/handlers/auto-recharge.ts`) performs the recharge.

**Handler steps:**

1. Load the subscription; verify `autoRechargeEnabled = true` AND
   `autoRechargeInProgress = true`. Otherwise mark delivery `done` with no side
   effects.
2. Load the company's default payment method. Missing → publish
   `send_communication` with `template = "notification"` and
   `eventKey = "billing.event.paymentFailure.auto-recharge"` (with
   `"billing.autoRecharge.noPaymentMethod"` as a resource entry); clear
   `autoRechargeInProgress`; finish.
3. Publish `send_communication` with `template = "notification"` and
   `eventKey = "billing.event.autoRechargeStarted"` (user should know a charge
   is being attempted).
4. Create
   `credit_purchase { amount: autoRechargeAmount, status:
   "pending", purpose: "auto-recharge" }`;
   publish `payment_due`. Since handlers can't block, this chains:
   `process_payment` sees the `purpose` flag and, on success, publishes a
   notification with `eventKey = "billing.event.paymentSuccess.auto-recharge"`
   - credits the balance; on failure, a notification with
     `eventKey = "billing.event.paymentFailure.auto-recharge"`.
5. Whichever terminal branch runs clears `autoRechargeInProgress = false`.

**Notification guarantees.** Every auto-recharge attempt generates ≥ 2
notifications: one `autoRechargeStarted` notice when initiated + one
`paymentSuccess.auto-recharge` or `paymentFailure.auto-recharge` when it
settles. Users can silence by disabling auto-recharge; the on/off state itself
triggers no extra notifications.

**Security.**

- `autoRechargeAmount` capped per subscription by
  `billing.autoRecharge.maxAmount` (default 50 000 ¢ / $500).
- Idempotency key: `subscriptionId + currentPeriodStart + monotonic
  counter` —
  retried deliveries never double-charge.
- The handler runs under a **synthesized subscription Tenant**:
  `tenant.companyId/systemId/systemSlug` copied from the subscription,
  `roles: ["system"]`, `permissions: ["*"]`. This is the only tenant backend
  workers construct explicitly, always through a dedicated helper in
  `server/utils/tenant.ts`.

#### 22.6 `Subscription` contract (rules-bearing fields)

```typescript
export interface Subscription {
  id: string;
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId?: string; // optional for free plans
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId?: string; // single voucher — replaced on re-apply (§22.7)
  remainingPlanCredits: number; // resets on renewal
  remainingOperationCount?: Record<string, number>; // per-resourceKey map; resets on renewal
  creditAlertSent: boolean; // one-shot (§22.3)
  operationCountAlertSent?: Record<string, boolean>; // per-resourceKey one-shot alert map
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number; // cents; 0 when disabled
  autoRechargeInProgress: boolean; // re-entrancy guard
  retryPaymentInProgress: boolean; // re-entrancy guard for retry_payment
  createdAt: string;
}
```

#### 22.7 Voucher scope & auto-removal cascade

Two invariants the voucher subsystem enforces end-to-end (core admin →
`apply_voucher` → billing display → recurring charge).

**Single-voucher invariant.** A `(company, system)` subscription has at most one
active voucher (`subscription.voucherId`). `apply_voucher` (§22.1) replaces the
existing voucher atomically in the same batched query — there is no stacking,
combining, or summing. The voucher most recently applied is the one in effect;
previous ones are simply overwritten (no audit row, since vouchers are codes the
user can re-enter at any time).

**Plan-scope rule.** Each voucher carries
`applicablePlanIds: array<record<plan>>`:

- **Empty array** — voucher is valid for every plan (the default).
- **Non-empty array** — voucher is valid only when the subscription's current
  `planId` is in the list. `apply_voucher` rejects with a validation error
  otherwise (i18n key `billing.voucher.planNotApplicable`).

**Auto-removal cascade on voucher edit.** The core voucher update
(`PUT /api/core/vouchers`) runs in a single batched `db.query()` that:

1. Updates the voucher record.
2. If `applicablePlanIds` is non-empty after the update, finds every
   subscription where `voucherId = <this voucher>` AND the subscription's
   `planId` is **not** in the new `applicablePlanIds`.
3. Clears `voucherId = NONE` on each such subscription.

Because steps 1–3 are one batched statement, subscriptions never sit in an
inconsistent state where the voucher still points to them but no longer applies.
After the batched query, the handler calls `Core.getInstance().reload()` (which
delegates to `updateCache("core", "data")` per §12.11, refreshing the voucher
cache) followed by `Core.getInstance().evictAllSubscriptions()` (which iterates
all tracked subscription cache keys and calls `clearCache` on each). Open
billing pages reflect the removal on their next reload (or instantly via live
query on `subscription`). No email is sent for this removal — the billing-page
reload communicates the change.

**Plan-change & voucher.** When a user switches plan (`subscribe` with a
different plan — §22.1), the old subscription is cancelled (voucher reference
cancelled with it) and the new subscription starts with `voucherId = NONE`. The
user must re-apply any voucher they wish to continue using; this also re-runs
the scope validation against the new plan.

**Core-admin UI surface.** The VoucherForm (§20.2) renders `applicablePlanIds`
via `SearchableSelectField(multiple={true})` fetching `/api/core/plans?search=`.
A hint under the field (`core.vouchers.applicablePlansHint`) reminds the
superuser that leaving the field empty makes the voucher valid for every plan,
and that removing a plan from a non-empty list strips the voucher from any
currently-subscribed company whose plan is removed.

#### 22.8 Payment ledger & history

The `payment` table (migration `0038`) is the unified ledger for all chargeable
transactions — recurring billing, credit purchases, and auto-recharge. Every
invocation of `process_payment` creates a `payment` record with
`status =
"pending"` before attempting the charge, and updates it to
`"completed"` or `"failed"` based on the outcome. The `invoiceUrl` field stores
the gateway invoice link returned by `PaymentResult.invoiceUrl`; when empty or
undefined, the frontend and email templates display
`billing.paymentHistory.invoiceNotAvailable`.

**Payment contract:**

```typescript
export interface Payment {
  id: string;
  companyId: string;
  systemId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  kind: "recurring" | "credits" | "auto-recharge";
  status: "pending" | "completed" | "failed" | "expired";
  paymentMethodId: string;
  transactionId?: string;
  invoiceUrl?: string;
  failureReason?: string;
  continuityData?: Record<string, any>; // async payment continuation info (§22.9)
  expiresAt?: string; // async payment expiry (§22.9)
  createdAt: string;
}
```

**Payment history API.**
`GET /api/billing?include=payments&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&cursor=…&limit=20`.
Returns `{ payments: Payment[], paymentsCursor: string | null }` in the response
data alongside existing billing data. Date range filter capped at 365 days.
Cursor-based pagination. Used by BillingPage section 7 (§21.4).

The GET response also includes `pendingAsyncPayments`: an array of `Payment`
records with `status = "pending"` and `continuityData IS NOT NONE`, used by the
BillingPage to render the pending payments banner (§22.9).

#### 22.9 Asynchronous (deferred) payments

Some payment methods (PIX, bank slips, cryptocurrency, etc.) do not settle
synchronously. When `IPaymentProvider.charge()` returns a `PaymentResult` with
`expiresInSeconds` and `continuityData`, the payment enters a deferred
lifecycle:

1. **Deferred detection.** `process_payment` checks for `expiresInSeconds` on
   the `PaymentResult`. If present, the payment record stays
   `status = "pending"`, `continuityData` and `expiresAt` are written (see
   `0038_create_payment.surql`), and a `payment-pending` email is sent to the
   user with the continuation data (QR code, payment link, barcode). The
   subscription/credit-purchase is **not** yet activated.
2. **Webhook resolution.** The payment provider calls
   `POST /api/public/webhook/payment`. The route is a generic scaffold — it
   parses the JSON body for `transactionId`, `status`, optional `invoiceUrl`,
   and optional `failureReason`. Provider-specific request validation
   (signatures, headers, payload normalization) is the responsibility of the
   adapter layer wrapping this endpoint. On success or failure, the route
   publishes `payment_async_completed` which triggers the
   `resolve_async_payment` handler that applies the same subscription/credit
   effects as the synchronous success or failure branch.
3. **Expiry.** A scheduled job (`expire-pending-payments`, runs every 15 min)
   marks any `payment` with `status = "pending"` and `expiresAt <= time::now()`
   as `status = "expired"`, also expires the related `credit_purchase`, clears
   re-entrancy guards on the subscription, and sends a `payment-expired`
   notification to the user.
4. **Backward compatibility.** When `PaymentResult` does NOT contain
   `expiresInSeconds`, the existing synchronous flow runs unchanged. No
   `continuityData` or `expiresAt` fields are written.

**Idempotency.** The webhook handler uses `transactionId` (from the provider) as
the idempotency key: if the payment is already `completed`, `failed`, or
`expired`, the webhook is acknowledged but ignored (200, no mutation). The
`resolve_async_payment` handler is also idempotent — it re-checks the payment
status before mutating subscription/credit state.

**Single-call rule.** The `resolve_async_payment` handler batches all DB
mutations into a single `db.query()` call, identical to the synchronous path in
`process_payment`.

**Race condition.** Both the webhook handler and the expiry job use conditional
updates (`WHERE status = "pending"`). Whichever runs first wins; the other sees
the status has changed and skips.

**Webhook endpoint.** `POST /api/public/webhook/payment` — public route (no
`withAuth`). Generic scaffold accepting a JSON body with `transactionId`,
`status` (`"succeeded"` or `"failed"`), optional `invoiceUrl`, optional
`failureReason`. Provider-specific validation (signatures, headers, payload
normalization) is handled by the adapter layer outside this route.

**PaymentResult extension:**

```typescript
export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
  invoiceUrl?: string;
  expiresInSeconds?: number; // present for async payment methods
  continuityData?: Record<string, any>; // e.g. { qrCodeUrl, paymentLink, barCode }
}
```

**Handler registry additions:**

```typescript
registerHandler("payment_async_completed", resolveAsyncPayment);
```

**BillingPage UI.** When `pendingAsyncPayments` is non-empty, the BillingPage
renders a yellow-themed banner section showing each pending payment with its
continuity data (QR code image, payment link button, barcode text) and expiry
time. A 30-second polling interval detects when payments resolve. The payment
history list shows `"expired"` status in orange.

### 23. Public / Anonymous API

#### 23.1 `GET /api/public/system`

See §13.4.

#### 23.2 `POST /api/leads/public` — unauthenticated lead registration / update verification

- Requires `botToken` (bot-protection challenge).
- Payload: `name`, `channels: {type,value}[]` (at least one required),
  `profile`, `companyIds`, `systemSlug`, `termsAccepted`. **Tags are not
  accepted** — only authenticated users can manage tags.
- Backend requires `termsAccepted: true`; rejects otherwise.
- **New lead:** create `lead` + `profile`, then one `entity_channel` row per
  submitted channel (all unverified) in a single batched query. Associate with
  `companyIds` + system. Publish one `send_communication` with
  `template = "human-confirmation"` and
  `templateData.actionKey = "auth.action.leadRegister"` on the channel types
  ordered by submission preference. Return `{ requiresVerification: true }`.
- **Existing lead** (matched by any channel `(type, value)` pair): do not modify
  directly. Create a `verification_request` with
  `actionKey = "auth.action.leadUpdate"` capturing the proposed diff in its
  payload; publish `send_communication` with `template = "human-confirmation"`.
  Return `{ requiresVerification: true }`. Lead data and channel rows are
  updated only after the user clicks the confirmation link.
- **Cooldown:** `communicationGuard()` (§12.13). Returns 429 if blocked.
- **Expiry:** `auth.communication.expiry.minutes` for the confirmation token.
- System-specific routes (e.g. `/api/systems/grex-id/leads/public`) can delegate
  here and add their own logic (e.g. face biometrics).

#### 23.3 `GET /api/public/front-core`

See §10.2 / §13.4.

### 24. OAuth Server Flow (Connected Apps)

The platform acts as an OAuth **server** so third-party apps can request scoped
access to a user's data. **This is not social login.**

#### 24.1 Authorization URL format

```
/oauth/authorize
  ?client_name=MyApp                     # display name
  &permissions=read:leads,write:tags     # comma-separated
  &system_slug=grex-id                   # target system
  &redirect_origin=https://myapp.com     # origin for postMessage reply
```

#### 24.2 Full flow

1. **External app** (browser):

   ```javascript
   const popup = window.open(
     `${platformBaseUrl}/oauth/authorize?client_name=MyApp&permissions=read:leads&system_slug=grex-id&redirect_origin=https://myapp.com`,
     "oauth",
     "popup,width=520,height=640",
   );
   window.addEventListener("message", (e) => {
     if (e.origin !== platformBaseUrl) return;
     const { token, error } = e.data;
     if (token) { /* store, call API */ }
   });
   ```

2. **Authorization page** (`app/(auth)/oauth/authorize/page.tsx`) reads URL
   params.
   - **Not authenticated:** redirect to
     `/login?oauth=1&client_name=...&permissions=...&system_slug=...&redirect_origin=...`
     and return here after login.
   - **Authenticated:** show app name, a company selector (user picks which
     company grants access), the requested permission list, and **Authorize** /
     **Cancel** buttons.

3. **On Authorize** — the page calls `POST /api/auth/oauth/authorize`:

   ```
   POST /api/auth/oauth/authorize
   Authorization: Bearer <system_token>
   Body: {
     clientName: string;
     permissions: string;              // comma-separated
     systemSlug: string;
     companyId: string;
     redirectOrigin: string;
     monthlySpendLimit?: number;
   }
   Response: { success: true, data: { token: string, app: ConnectedApp } }
   ```

   Backend:
   - Resolves `systemId` from `systemSlug`.
   - Creates `connected_app` (UI-facing metadata).
   - Creates `api_token` (the actual bearer credential) linked to the
     authorizing user + company + system with the granted permissions,
     `exchangeable: false`, embedded Tenant.
   - Returns the raw token **once**; only its SHA-256 hash is stored in
     `api_token.tokenHash`.
   - Page posts back:
     `window.opener.postMessage({ token },
     redirectOrigin); window.close();`.

4. **On Cancel / Deny** — page posts `{ error: "access_denied" }`.

5. **Login page integration** (`app/(auth)/login/page.tsx`). When `oauth=1` is
   present, after successful login the router pushes to `/oauth/authorize?...`
   (with all OAuth params) instead of `/entry`.

#### 24.3 Connected Apps page

See §21.3. No manual creation — apps appear only via the OAuth flow. Revocation
sets `revokedAt` on the underlying `api_token` (§19.12).

#### 24.4 Manually created API tokens

Users can also create API tokens via the Tokens menu (§21.2). Each token has a
name, description, selected granular permissions, optional spend limit, optional
expiry (mutually exclusive with `neverExpires`), optional `frontendUse` +
`frontendDomains`. The raw value is shown once and never stored — only its
SHA-256 hash.

### 25. Terms of Acceptance (LGPD)

Every system has its own terms of acceptance including LGPD compliance text. The
core provides a generic fallback via the `terms.generic` setting; systems
override with `System.termsOfService`.

#### 25.1 Resolution order

1. `System.termsOfService` (if non-empty).
2. `terms.generic` core setting.
3. Hardcoded i18n key `common.terms.fallback`.

#### 25.2 Mandatory checkpoints

1. **User registration** (`/register`): checkbox with terms text (or link). Must
   be checked. Backend validates `termsAccepted: true` on `/api/auth/register`;
   rejects with `validation.terms.required`.
2. **Public lead registration / update** (`POST /api/leads/public`): requires
   `termsAccepted: true`. Any public frontend form submitting here must include
   the checkbox.

#### 25.3 Display

Terms HTML stored in the DB. On the frontend, terms render inside a scrollable
container (`max-height` + `overflow-y-auto`) above the acceptance checkbox. The
checkbox label uses `auth.register.termsAccept` / `common.terms.accept`.

Below the checkbox, a **"View Terms of Service"** link opens
`/terms?system=<slug>` in a **new browser tab** so users can read the full terms
without leaving the form.

#### 25.4 API surface

`GET /api/public/system` includes the resolved terms:

```typescript
export interface PublicSystemInfo {
  name: string;
  slug: string;
  logoUri: string;
  defaultLocale?: string;
  termsOfService?: string; // resolved (system → generic)
}
```

Any public page can display the correct terms without authentication.

#### 25.5 Public terms page (`app/(auth)/terms/page.tsx`)

Renders the full terms for a system at `/terms?system=<slug>` (no auth):

1. Read `?system=<slug>`.
2. Fetch `/api/public/system?slug=<slug>`.
3. Render system branding (logo + name) at the top.
4. Render terms HTML full-width, readable.
5. If no terms available, render `common.terms.fallback`.
6. Include `LocaleSelector` for language switching.

Admin management is covered in §20.5 (`TermsEditor`).

#### 25.6 Data-tracking consent popup

A global `CookieConsent` popup (§18.1.3) appears on every page — public and
authenticated alike — until the user records a decision. It carries:

1. A message rendered via the i18n key `common.cookieConsent.message` (EN: "This
   website uses data tracking technology.", PT-BR: "Este site usa tecnologia de
   rastreamento de dados.").
2. A link to the full **Terms of Service & LGPD Privacy Policy** (opens
   `/terms?system=<slug>` in a new tab — same slug as the page's branding
   resolution, falling back to `app.defaultSystem` on public pages).
3. An **Accept** button and a **Decline** button.

The decision is stored in the `core_data_tracking_consent` cookie with a
**6-month lifetime** (`days = 180`). Values are `"accepted"` or `"declined"`.
While the cookie is missing or set to `"declined"`, any frontend code that
captures or records a characteristic listed in
`front.dataTracking.trackedCharacteristics` (§10.2.6) MUST short-circuit — the
hook `useDataTrackingConsent()` exposes this state and is the only supported
gate.

`front.dataTracking.trackedCharacteristics` starts as an empty JSON array and is
expanded additively as new tracked characteristics are introduced by Core or
subframeworks. No code writes directly to the list — the superuser manages it in
the Front Settings editor.

---

## Part G — Extensibility

### 26. Subframeworks

The Core supports **subframeworks** — reusable, self-contained extensions that
live under `frameworks/<name>/` in a **strictly separate namespace**. A
subframework is **not** a system (systems are runtime tenants; subframeworks are
design-time code bundles). Each framework is an isolated module with its own
`AGENTS.md`, API routes, queries, migrations, components, and i18n files.
**There is no mixing of names or folders between the Core and any framework, or
between different frameworks, under any circumstances** — the same
namespace-separation discipline applied to systems (§6) applies here.

#### 26.1 Folder layout

Each subframework lives under `frameworks/<name>/` and contains a
**self-contained subtree** that mirrors the Core's logical layers but remains
physically isolated. No framework file is ever merged, symlinked, or aliased
into the Core's own directories.

```
frameworks/
└── foo/                                  # framework name = top-level folder
    ├── AGENTS.md                         # framework-specific specification
    ├── app/
    │   └── api/
    │       └── foo/                      # framework API routes (namespaced)
    │           └── route.ts
    ├── src/
    │   ├── components/
    │   │   └── foo/                      # framework components (namespaced)
    │   │       └── FooCard.tsx
    │   ├── contracts/
    │   │   └── foo.ts                    # framework contracts
    │   └── i18n/
    │       ├── en/foo.json               # framework i18n (en)
    │       └── pt-BR/foo.json            # framework i18n (pt-BR)
    ├── server/
    │   ├── db/
    │   │   ├── migrations/
    │   │   │   └── 0100_create_foo.surql # framework migrations (globally numbered)
    │   │   └── queries/
    │   │       └── foo.ts                # framework queries
    │   └── utils/
    │       └── foo-helper.ts             # framework utilities
    └── public/
        └── foo/                          # framework static assets
```

**Namespace rules (non-negotiable):**

1. **Every file belongs to exactly one framework or to the Core.** A framework
   file lives under `frameworks/<name>/`; a Core file lives under the project
   root. Never the twain shall mix.
2. **Framework names are unique.** No two frameworks share the same `<name>`
   folder. The name is the namespace identifier — it appears in route paths,
   component directories, i18n file names, and migration relative paths.
3. **API routes are namespaced.** A framework's routes live under
   `frameworks/<name>/app/api/<name>/`. The resulting HTTP path is
   `/api/<name>/…`. This prevents route collisions with Core or other
   frameworks.
4. **Components are namespaced.** Framework components live under
   `frameworks/<name>/src/components/<name>/`. Import paths always include the
   framework name.
5. **i18n files are namespaced.** Framework translation files follow the pattern
   `frameworks/<name>/src/i18n/<locale>/<name>.json`. Keys live under the
   framework name domain (e.g. `foo.section.label`).
6. **Migrations are globally numbered** but physically isolated. The migration
   runner scans `frameworks/<name>/server/db/migrations/` for each framework,
   merges the found files with root and system migrations, sorts by numeric
   prefix globally, and records the relative path (e.g.
   `frameworks/foo/0100_create_foo.surql`) in `_migrations`.

**Adding a new framework** creates the full folder skeleton above, plus a
`.gitkeep` in every empty structural directory. The framework is registered via
`frameworks/index.ts` (§26.4).

#### 26.2 AGENTS.md inheritance

Every framework ships its own `frameworks/<name>/AGENTS.md` that **inherits the
Core AGENTS by reference**. It describes only what is framework-specific:

- Contracts, routes, queries, handlers, components the framework adds.
- New Core / FrontCore settings required (added through its own seeds).
- System-slug-like markers the framework uses for scoping.
- Framework-specific i18n namespaces (e.g. `foo.*` in `foo.json`).

Everything else — visual standard, i18n rules, tenant handling, middleware,
single-call rule, deduplicator/standardizer/validator use, event-queue
conventions, email template design, security/revocation rules — is inherited
verbatim from Core.

Every framework AGENTS.md starts with:

> This framework extends the Core. It inherits every rule, convention,
> structure, naming policy, and architectural decision from the root
> `AGENTS.md`. This document lists only what is framework-specific.

#### 26.3 Interaction with Systems

Frameworks and systems are orthogonal. A framework may publish:

- Components registered in `src/components/systems/registry.ts` — a system's
  menus can reference these. Registration imports from the framework's
  namespaced component path.
- API routes consumable by systems (under `/api/<name>/…`).
- Event handlers and templates that systems publish events to.
- Migrations creating new tables or extending existing ones (with the usual
  `companyId` + `systemId` scoping when tenant-specific).

A framework **MUST NOT**:

- Place files outside `frameworks/<name>/`. No exceptions.
- Import from or export to another framework's namespace directly —
  inter-framework communication goes through the Core's event queue or shared
  contracts.
- Introduce a routing prefix that bypasses `withAuth` + `ctx.tenant`.
- Read `companyId`/`systemId` from request bodies or cookies.
- Break backwards compatibility with Core routes, tables, or contracts. Additive
  changes only; renames require a full migration-and-cleanup commit.
- Share component, query, migration, or i18n files with the Core or another
  framework. Each namespace is physically and logically isolated.

#### 26.4 Registration

**Systems and frameworks are distinct.** Systems are runtime tenants (e.g.
grex-id) whose code lives under `server/db/queries/systems/`,
`src/components/systems/`, etc. Frameworks are design-time code bundles under
`frameworks/<name>/`. Both use the same module-registry API (§12.9), but
register through separate entry points.

**System registration** — `systems/index.ts` imports each system's
`systems/[slug]/register.ts`:

```typescript
// Example: systems/grex-id/register.ts
import { registerHandler, registerComponent, registerHomePage,
         registerSystemI18n, registerTemplate, registerTemplateBuilder,
         registerChannel, registerLifecycleHook }
  from "@/server/module-registry";

export function register(): void {
  // Event handlers — name is both the event and the handler function key
  registerHandler("grexid_process_detection", processDetection);

  // Components
  registerComponent("grexid-locations", () => import("..."));
  registerHomePage("grex-id", () => import("..."));

  // i18n
  registerSystemI18n("grex-id", "en", enGrexId);
  registerSystemI18n("grex-id", "pt-BR", ptBRGrexId);

  // Lifecycle hooks
  registerLifecycleHook("lead:delete", async ({ leadId }) => { ... });
}
```

**Framework registration** — `frameworks/index.ts` imports each framework's
`frameworks/[name]/register.ts` (same shape as above).

**Boot wiring** (`server/jobs/index.ts`):

1. `registerCore()` — core handlers + core jobs.
2. `registerAllSystems()` — each system's `register()`.
3. `registerAllFrameworks()` — each framework's `register()`.
4. `startEventQueue()` — resolves handlers from registry.
5. `getAllJobs()` — starts registered recurring jobs.

**Invariants:**

- The core never imports subsystem or framework code directly.
- Exactly one `register()` function per system/framework — imported only by
  `systems/index.ts` or `frameworks/index.ts` respectively.
- Components, homepages, event handlers, jobs, i18n, and lifecycle hooks, and
  communication templates are all registered through the module-registry API at
  boot.

---

## Part H — Roadmap

### 27. Implementation Plan

Phases ordered by dependency. Each builds on the previous.

**Phase 1 — Foundation.** Next.js 16 + TS strict; Tailwind 4.2 + CSS variables
(§4); `src/contracts/`; `server/db/connection.ts` (§7.4); migration runner + all
migration files (§8); seed runner + `001_superuser` + `002_default_settings` +
`003_default_front_settings`; `Core` singleton + server-only guard; i18n
skeleton with `en` and `pt-BR`. **Done when:** migrations run, superuser exists,
Core loads.

**Phase 2 — Authentication.** `@panva/jose` token utilities; rate limiter; all
`/api/auth/*` routes; `BotProtection`; auth pages (login, register w/ LGPD
checkbox §25, verify, forgot-password, reset-password, account-recovery);
verification-request system w/ `communicationGuard()` (§12.13);
entity_channel-based account approval invariant (§19.3); terms-acceptance
validation on register + public leads; `useAuth`; minimal event-queue foundation
(`send_communication` dispatcher + `send_email` per-channel handler +
`human-confirmation` + `notification` templates).

**Phase 3 — Event Queue.** `publisher.ts`, `registry.ts`, `worker.ts` (claim,
lease, backoff, dead-letter); `send_communication` dispatcher + `send_email` and
`send_sms` per-channel handlers; unified `human-confirmation` and `notification`
templates per channel; `start-event-queue`.

**Phase 4 — Shared UI Components.** `Spinner`, `LocaleSelector`, `Modal`,
`SearchField` (+ `useDebounce`), `GenericList` + `GenericListItem`,
`CreateButton`/`EditButton`/`DeleteButton`, `FilterDropdown`, `DateRangeFilter`,
`FilterBadge`, `FormModal`, `GenericFormButton`, `ErrorDisplay`,
`FileUploadField`, `SearchableSelectField`, `DynamicKeyValueField`,
`MultiBadgeField`, all subforms (§18.5), `DownloadData`, `SystemBranding`,
`TagSearch`.

**Phase 5 — Core Admin Panel.** Middleware pipeline; core API routes (systems,
roles, plans, vouchers, menus, terms, data-deletion, settings, front-settings,
settings/missing); core queries; core UI pages (including `SystemForm` w/
`FileUploadField` logo, `MultiBadgeField` usage); `MenuTreeEditor` (§20.3);
`SettingsEditor` + `FrontSettingsEditor`; `TermsEditor`; `DataDeletion`; public
terms page; i18n keys for every label; component + menu registry.

**Phase 6 — Multi-Tenant User Flow & Subsystem Panel.** Onboarding pages
(company creation, system-selection with rich plan cards); post-login onboarding
guard (§18.8, §19.5); company API + queries; `Sidebar` + `SidebarMenuItem` +
`SidebarSearch`; `ProfileMenu` with company/system switcher; `useSystemContext`
w/ cookie persistence; `(app)` layout with system branding (Sidebar logo + name,
never "Core"); menu loading per §18.8 (custom + hardcoded defaults w/ offset
`sortOrder`).

**Phase 7 — Billing & Payment.** All `POST /api/billing` actions (§22.1);
billing queries; client-side payment tokenization; server-side payment provider;
`BillingPage`; plan cards (§18.10) shared between onboarding and billing.

**Phase 8 — Usage, Storage & Credit Tracking.** `credit_expense` migration;
`credit-tracker.ts` (`trackCreditExpense` + `consumeCredits`); storage via
`fs.readDir()`; `GET /api/usage` (dual-mode: tenant + core superuser);
`UsagePage` (dual-mode, storage bar chart, credit-expense column chart,
`DateRangeFilter` max 31 days, summary table, **no API-call metric**);
`PlanCard` shared component (billing + onboarding + core plans).

**Phase 8.5 — Connected Apps, Tokens & Users CRUD.** `UsersPage` with invite
flow; `TokensPage` (neverExpires/expiresAt exclusivity, frontendUse +
frontendDomains, raw token once); `ConnectedAppsPage` (OAuth-only creation,
revoke sets `revokedAt`); OAuth popup flow; spend-limit enforcement.

**Phase 9 — Live Queries & Real-Time.** `src/lib/db/connection.ts` (WebSocket);
`useLiveQuery`; frontend query files with `LIVE SELECT` + proper `PERMISSIONS`;
integration with UI.

**Phase 10 — Recurring Billing Job.** `recurring-billing.ts`; integration with
`process_payment`; `past_due` + grace periods; `server/jobs/index.ts` starter.

### 28. Technical Decisions & Trade-offs

| Decision                                           | Rationale                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SurrealDB HTTP for backend, WebSocket for frontend | Serverless runtimes support HTTP; WebSocket is needed only for live queries in the browser.                                                                                                                               |
| In-memory rate limiter                             | Serverless instances share no state; rate limits are per-instance approximations. Migrate to DB-backed counter for strict enforcement.                                                                                    |
| Cursor-based pagination (never SKIP)               | Stable performance regardless of dataset size; no missed/duplicated rows on concurrent writes.                                                                                                                            |
| Event queue in SurrealDB (not external broker)     | Reduces infra dependencies. Suitable for moderate throughput. Move to an external broker if throughput exceeds SurrealDB capacity.                                                                                        |
| Core singleton with reload                         | Avoids repeated DB queries for config. Trade-off: briefly stale during reload. Acceptable for config data.                                                                                                                |
| Argon2 via SurrealDB built-in                      | Avoids native module dependencies. Password hashing/verification inside the DB.                                                                                                                                           |
| No custom CSS beyond variables                     | Enforces design consistency. Tailwind covers all styling.                                                                                                                                                                 |
| Emojis instead of icons                            | Zero icon-library dependency.                                                                                                                                                                                             |
| `@panva/jose` for JWTs                             | Pure JS; works in all serverless runtimes.                                                                                                                                                                                |
| `react-chartjs-2` for charts                       | Flexible, well-documented; covers all chart needs.                                                                                                                                                                        |
| Token embeds the full Tenant                       | Single source of context for frontend + backend. Eliminates scattered `companyId`/`systemId`. Token exchange is the only context switch.                                                                                  |
| Split Core vs FrontCore settings tables            | Physical separation guarantees the frontend bundle cannot leak server-only secrets.                                                                                                                                       |
| Subframeworks use separate namespaces              | Physical isolation under `frameworks/<name>/` prevents route collisions, import entanglement, and accidental scope leakage between frameworks and Core. Each framework is a self-contained module with its own AGENTS.md. |
