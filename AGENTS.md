# Multi-Tenant Platform

## 1. Project Overview

A serverless multi-tenant platform supporting multiple users, companies, and
systems. Users authenticate once, associate with companies, and subscribe to
systems via plans. A superuser manages the core (global configuration, systems,
roles, plans, menus). Each system renders its own UI, menus, and features
according to the active plan and user roles.

Each system has its own **custom public homepage** — a dedicated `.tsx`
component registered in the homepage registry. The homepage is accessible
without authentication at `/?system=<slug>`. A core setting
(`app.defaultSystem`) specifies which system's homepage is shown when no
parameter is provided. If no matching system or homepage component is found, a
core fallback homepage is displayed. All public-facing pages (homepage, auth
pages) receive the system context (logo, name) via the same `?system=` parameter
so branding is consistent throughout the unauthenticated flow.

**Key constraints:**

- Serverless runtime — no Node/Deno/Bun-specific APIs; only standard Web APIs
  (`fetch`, `crypto`, `Request`, `Response`, etc.).
- Mobile-first responsive UI.
- Build the most visually stunning interface possible using Tailwind CSS.
- **Every AJAX request renders a `<Spinner />` in the appropriate place** — not
  just form submissions, but also initial data loads, deletes, inline adds, drag
  operations, and any other `fetch()` call. The spinner must appear in the
  context where the action is happening (e.g. inside the button that triggered
  it, or replacing the content area while loading).
- Every searchable text field uses a configurable debounce.
- No custom CSS beyond CSS variable declarations — TailwindCSS utilities only.
- Emojis instead of icon libraries.
- All UI text uses i18n keys with initial `en` and `pt-BR` translations.
- **Backend never returns human-readable text to the frontend.** All API error
  messages, validation errors, and status messages must be i18n keys (e.g.
  `"validation.email.invalid"`, `"common.error.generic"`). The frontend resolves
  them via `t()`. This applies to:
  - Validation error arrays
    (`{ code: "VALIDATION", errors: ["validation.email.required"] }`).
  - Generic error messages
    (`{ code: "ERROR", message: "common.error.generic" }`).
  - File upload errors, rate limit errors, and any other API response text.
- **Communication templates use i18n keys** — email/SMS templates call `t()` to
  resolve all text, never hardcode human-readable strings.
- **Compositional database model** — reusable data structures (profiles,
  addresses) are stored as separate tables and referenced via `record<>` links,
  never embedded as sub-objects. SurrealDB `FETCH` resolves the links at query
  time so the API response shape includes the full nested objects. When creating
  an entity that references a composable, first `CREATE` the composable record,
  then `CREATE` the parent with the record link. When updating, update the
  composable record directly. When deleting, delete both the parent and the
  composable record.

---

## 2. Tech Stack

| Layer        | Technology         | Version      |
| ------------ | ------------------ | ------------ |
| Framework    | Next.js            | 16           |
| Database     | SurrealDB          | 3.0          |
| Styling      | TailwindCSS        | 4.2          |
| Charts       | react-chartjs-2    | latest       |
| File storage | @hviana/surreal-fs | latest (jsr) |
| Token/JWT    | @panva/jose        | latest (jsr) |
| Language     | TypeScript         | strict mode  |

**Allowed packages (exhaustive):**

- `jsr:@hviana/surreal-fs`
- `jsr:@panva/jose`
- `npm:react-chartjs-2`
- `npm:chart.js` (peer dependency of react-chartjs-2)
- `npm:surrealdb` (official SurrealDB JS SDK)
- `npm:xlsx` (XLSX spreadsheet generation for data export)

No other packages are permitted unless explicitly approved.

---

## 3. Visual Standard & CSS Variables

Declare in `app/globals.css` at `:root` scope. These are the **only** custom CSS
declarations allowed in the entire project. Everything else uses TailwindCSS
utilities exclusively.

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

**Visual rules (implemented via TailwindCSS utilities only):**

- Dark backgrounds with subtle gradients.
- Cards use glassmorphism effect:
  `backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)]`.
- Hover effects:
  `hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20`.
- Gradient borders use
  `bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)]`.
- Consistent color usage: primary actions use `--color-primary-green`,
  secondary/accent uses `--color-secondary-blue`, backgrounds use
  `--color-black`, borders use `--color-dark-gray`, secondary text uses
  `--color-light-text`.
- **Input placeholders:** Every `<input>` and `<textarea>` must use
  `placeholder-white/30` for visibility against dark backgrounds. Never use
  `placeholder-[var(--color-light-text)]/50` or omit the placeholder color class
  — both result in invisible or near-invisible text. Placeholder text must
  always come from `t()` (e.g. `placeholder={t("common.placeholder.email")}`)
  and never be hardcoded in English. Common placeholder keys live under
  `common.placeholder.*` in the i18n files. Labels on form fields follow the
  same rule — no hardcoded strings, always `t()`.

---

## 4. Internationalization (i18n)

### 4.1 Structure

Translations live under `src/i18n/`. Each locale is a folder containing
domain-scoped JSON files.

```
src/i18n/
├── en/
│   ├── common.json
│   ├── auth.json
│   ├── core.json
│   ├── billing.json
│   ├── homepage.json
│   ├── templates.json
│   ├── validation.json
│   └── systems/
│       └── {system-slug}.json
├── pt-BR/
│   ├── common.json
│   ├── auth.json
│   ├── core.json
│   ├── billing.json
│   ├── homepage.json
│   ├── templates.json
│   ├── validation.json
│   └── systems/
│       └── {system-slug}.json
└── index.ts          # loader + `t(key, locale, params?)` function
```

### 4.2 Translation function contract

```typescript
// src/i18n/index.ts
export function t(
  key: string,
  locale: string,
  params?: Record<string, string>,
): string;
// key format: "domain.section.label" e.g. "auth.login.title"
// Returns the key itself as fallback if not found.
```

### 4.3 Locale provider and resolution

`src/hooks/LocaleProvider.tsx` — a React context provider that wraps the
application in the root layout. It manages the active locale, persists it in a
cookie, and provides the `t()` function to all descendants. Changing the locale
re-renders all consumers immediately (no page refresh required).

**Locale resolution order (first non-null wins):**

1. User's cookie (`core_locale`) — set when the user picks a language.
2. `System.defaultLocale` — per-system default configured in the core admin.
3. Hardcoded `"en"`.

When the user changes locale via `LocaleSelector`, the cookie is updated and, if
the user is authenticated, the backend is called
(`PUT /api/users?action=locale`) to persist the locale in `user.profile.locale`.
This ensures that server-side operations (e.g. emails, SMS) use the user's
preferred language even without cookie access. The `profile.locale` is also set
at registration time from the frontend's active locale.

**Email/SMS locale resolution (server-side, in send-email/send-sms handlers):**

1. `payload.locale` — explicitly passed by the caller (should be the user's
   `profile.locale` when available).
2. `System.defaultLocale` — via `payload.systemSlug`.
3. Hardcoded `"en"`.

There is no global `app.defaultLocale` setting. Each system defines its own
default locale. When no system context is available and the user has no cookie,
the hardcoded `"en"` is used.

The `LocaleProvider` accepts an optional `defaultLocale` prop. The `(app)`
layout and public pages (via `usePublicSystem`) resolve this from the current
system's `defaultLocale` field.

### 4.4 Locale selector component

`src/components/shared/LocaleSelector.tsx` — a small, subtle dropdown rendered
on every page. Stores the selected locale in a cookie. Receives no props; reads
the current locale from the `LocaleContext`.

### 4.5 Roles, plans, menu items, and plan benefits

Their display names are i18n keys resolved at render time. The database stores
the i18n key string (e.g. `"roles.admin.name"`), not the translated text.

---

## 5. Project File Structure

```
/
├── app/                              # Next.js 16 App Router
│   ├── globals.css                   # CSS variables ONLY (Section 3)
│   ├── layout.tsx                    # Root layout (locale provider, system context)
│   ├── page.tsx                      # Public homepage (promotional, reads ?system=)
│   ├── (auth)/                       # Auth route group (no sidebar, reads ?system=)
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── verify/page.tsx           # Email/SMS verification
│   │   ├── forgot-password/page.tsx
│   │   ├── reset-password/page.tsx
│   │   └── terms/page.tsx            # Public terms page (opens in new tab, reads ?system=)
│   ├── (app)/                        # Authenticated route group (sidebar layout)
│   │   ├── layout.tsx                # Sidebar + profile menu + system logo + content area
│   │   ├── onboarding/
│   │   │   ├── company/page.tsx      # Create first company
│   │   │   └── system/page.tsx       # Choose system + subscribe to plan
│   │   ├── entry/page.tsx             # Spinner-only landing pad (login redirects here)
│   │   ├── usage/page.tsx            # Usage overview (API calls, storage, credits)
│   │   └── [...slug]/page.tsx        # Dynamic route resolved by menu component mapping
│   ├── (core)/                       # Superuser-only core route group
│   │   ├── layout.tsx
│   │   ├── systems/page.tsx
│   │   ├── roles/page.tsx
│   │   ├── plans/page.tsx
│   │   ├── vouchers/page.tsx
│   │   ├── menus/page.tsx
│   │   ├── terms/page.tsx             # Terms of service management per system
│   │   ├── data-deletion/page.tsx    # Delete company+system data (superuser)
│   │   └── settings/page.tsx         # Key-value env-like settings
│   └── api/                          # Backend API routes
│       ├── public/
│       │   └── system/route.ts       # GET ?slug= — public system info (no auth)
│       ├── auth/
│       │   ├── login/route.ts
│       │   ├── register/route.ts
│       │   ├── verify/route.ts
│       │   ├── forgot-password/route.ts
│       │   ├── reset-password/route.ts
│       │   ├── refresh/route.ts
│       │   └── oauth/[provider]/route.ts
│       ├── core/
│       │   ├── systems/route.ts
│       │   ├── roles/route.ts
│       │   ├── plans/route.ts
│       │   ├── vouchers/route.ts
│       │   ├── menus/route.ts
│       │   ├── terms/route.ts          # GET/PUT — manage terms per system
│       │   ├── data-deletion/route.ts  # DELETE — remove company+system data
│       │   └── settings/
│       │       ├── route.ts
│       │       └── missing/route.ts  # Returns settings requested but not defined
│       ├── users/route.ts
│       ├── companies/
│       │   ├── route.ts
│       │   └── [companyId]/
│       │       └── systems/route.ts  # GET — list systems for a company
│       ├── billing/route.ts
│       ├── usage/route.ts
│       ├── connected-apps/route.ts
│       ├── tokens/route.ts
│       ├── leads/
│       │   ├── route.ts
│       │   └── public/route.ts       # Unauthenticated lead registration + update verification
│       ├── tags/route.ts
│       ├── files/
│       │   ├── upload/route.ts
│       │   └── download/route.ts
│       └── systems/
│           └── [system-slug]/        # System-specific API routes
│               └── .gitkeep
├── src/
│   ├── components/
│   │   ├── shared/                   # Generic reusable components
│   │   │   ├── Spinner.tsx
│   │   │   ├── LocaleSelector.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── GenericList.tsx
│   │   │   ├── GenericListItem.tsx
│   │   │   ├── SearchField.tsx       # Debounced search input
│   │   │   ├── CreateButton.tsx
│   │   │   ├── EditButton.tsx
│   │   │   ├── DeleteButton.tsx
│   │   │   ├── FilterDropdown.tsx
│   │   │   ├── DateRangeFilter.tsx
│   │   │   ├── FilterBadge.tsx
│   │   │   ├── FormModal.tsx
│   │   │   ├── GenericFormButton.tsx  # Submit with spinner
│   │   │   ├── ErrorDisplay.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── SidebarMenuItem.tsx   # Recursive, unlimited depth
│   │   │   ├── SidebarSearch.tsx
│   │   │   ├── ProfileMenu.tsx        # User avatar, company/system switcher, logout
│   │   │   ├── BotProtection.tsx     # Anti-bot challenge widget
│   │   │   ├── TagSearch.tsx         # Tag filter using MultiBadgeField (search mode)
│   │   │   ├── DownloadData.tsx     # Export array of objects as XLSX file download
│   │   │   └── SystemBranding.tsx    # System logo+name for auth pages
│   │   ├── subforms/                 # Reusable sub-form components
│   │   │   ├── ProfileSubform.tsx    # Shared by users & agents: name, avatar, age
│   │   │   ├── ContactSubform.tsx
│   │   │   ├── PasswordSubform.tsx
│   │   │   ├── AddressSubform.tsx
│   │   │   ├── CompanyIdentificationSubform.tsx
│   │   │   ├── CreditCardSubform.tsx
│   │   │   ├── NameDescSubform.tsx              # Name + description with configurable limits
│   │   │   └── LeadCoreSubform.tsx              # Lead identification, contact, profile, tags
│   │   ├── fields/                   # Complex reusable field components
│   │   │   ├── FileUploadField.tsx
│   │   │   ├── SearchableSelectField.tsx  # Debounced search + badge selection
│   │   │   ├── DynamicKeyValueField.tsx   # For core env-like settings
│   │   │   └── MultiBadgeField.tsx        # Multi-value badge input (custom text or search)
│   │   ├── core/                     # Core-specific components
│   │   │   ├── SystemForm.tsx
│   │   │   ├── RoleForm.tsx
│   │   │   ├── PlanForm.tsx
│   │   │   ├── VoucherForm.tsx
│   │   │   ├── MenuTreeEditor.tsx    # Tree editor with drag-and-drop, inline add, per-system
│   │   │   ├── TermsEditor.tsx      # Terms of service editor per system + generic fallback
│   │   │   ├── DataDeletion.tsx     # Delete company+system data with confirmation modal
│   │   │   └── SettingsEditor.tsx
│   │   └── systems/                  # System-specific components
│   │       ├── registry.ts           # Component + homepage registry
│   │       └── [system-slug]/
│   │           ├── HomePage.tsx      # System-specific public homepage
│   │           └── .gitkeep
│   ├── contracts/                    # TypeScript interfaces & types
│   │   ├── auth.ts
│   │   ├── profile.ts                # Composable: name, avatar, age, locale
│   │   ├── address.ts                # Composable: street, number, city, etc.
│   │   ├── user.ts
│   │   ├── company.ts
│   │   ├── system.ts
│   │   ├── role.ts
│   │   ├── plan.ts
│   │   ├── voucher.ts
│   │   ├── menu.ts
│   │   ├── billing.ts
│   │   ├── connected-app.ts
│   │   ├── token.ts
│   │   ├── file.ts
│   │   ├── event-queue.ts
│   │   ├── communication.ts
│   │   ├── payment-provider.ts
│   │   ├── usage.ts
│   │   ├── core-settings.ts
│   │   ├── tag.ts
│   │   ├── lead.ts
│   │   ├── location.ts
│   │   └── common.ts                # PaginatedResult, CursorParams, etc.
│   ├── i18n/                         # (Section 4)
│   │   ├── en/ ...
│   │   ├── pt-BR/ ...
│   │   └── index.ts
│   ├── hooks/                        # React hooks
│   │   ├── useDebounce.ts
│   │   ├── useAuth.ts
│   │   ├── useLiveQuery.ts
│   │   ├── useSystemContext.ts
│   │   ├── useLocale.ts
│   │   └── usePublicSystem.ts        # Fetch public system info (no auth)
│   └── lib/                          # Shared utilities (isomorphic, no secrets)
│       ├── formatters.ts
│       └── validators.ts
├── server/                           # Backend-only code (NEVER imported by frontend)
│   ├── db/
│   │   ├── connection.ts             # SurrealDB backend connection manager
│   │   ├── migrations/
│   │   │   ├── runner.ts             # Runs pending migrations, skips applied
│   │   │   ├── 0000_db_generals.surql
│   │   │   ├── 0001_create_user.surql          # profile is record<profile>
│   │   │   ├── 0002_create_company.surql       # billingAddress is record<address>
│   │   │   ├── 0003_create_company_user.surql
│   │   │   ├── 0004_create_system.surql
│   │   │   ├── 0005_create_company_system.surql
│   │   │   ├── 0006_create_user_company_system.surql
│   │   │   ├── 0007_create_role.surql
│   │   │   ├── 0008_create_plan.surql
│   │   │   ├── 0009_create_voucher.surql
│   │   │   ├── 0010_create_menu_item.surql
│   │   │   ├── 0011_create_subscription.surql
│   │   │   ├── 0012_create_payment_method.surql # billingAddress is record<address>
│   │   │   ├── 0013_create_credit_purchase.surql
│   │   │   ├── 0014_create_connected_app.surql
│   │   │   ├── 0015_create_api_token.surql
│   │   │   ├── 0017_create_usage_record.surql
│   │   │   ├── 0018_create_queue_event.surql
│   │   │   ├── 0019_create_delivery.surql
│   │   │   ├── 0020_create_core_setting.surql
│   │   │   ├── 0021_create_verification_request.surql
│   │   │   ├── 0022_create_live_query_permissions.surql
│   │   │   ├── 0023_create_lead.surql          # profile is record<profile>
│   │   │   ├── 0024_create_lead_company_system.surql
│   │   │   ├── 0025_create_location.surql
│   │   │   ├── 0029_create_tag.surql
│   │   │   ├── 0030_create_profile.surql       # Composable entity
│   │   │   ├── 0031_create_address.surql       # Composable entity
│   │   │   ├── 0032_create_credit_expense.surql # Daily credit expense containers
│   │   │   └── systems/
│   │   │       └── [system-slug]/              # System-specific migrations
│   │   │           └── *.surql
│   │   ├── seeds/
│   │   │   ├── runner.ts             # Runs seeds idempotently
│   │   │   ├── 001_superuser.ts
│   │   │   └── 002_default_settings.ts
│   │   ├── queries/
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── companies.ts
│   │   │   ├── systems.ts
│   │   │   ├── roles.ts
│   │   │   ├── plans.ts
│   │   │   ├── vouchers.ts
│   │   │   ├── menus.ts
│   │   │   ├── billing.ts
│   │   │   ├── connected-apps.ts
│   │   │   ├── tokens.ts
│   │   │   ├── usage.ts
│   │   │   ├── event-queue.ts
│   │   │   ├── core-settings.ts
│   │   │   ├── tags.ts
│   │   │   ├── leads.ts
│   │   │   ├── locations.ts
│   │   │   ├── data-deletion.ts      # Delete all company+system scoped data
│   │   │   └── systems/
│   │   │       └── [system-slug]/
│   │   │           └── .gitkeep
│   │   └── frontend-queries/         # Live query definitions (LIVE SELECT)
│   │       ├── messages.ts
│   │       ├── notifications.ts
│   │       └── systems/
│   │           └── [system-slug]/
│   │               └── .gitkeep
│   ├── middleware/
│   │   ├── withAuth.ts               # Token verification + role/permission check
│   │   ├── withRateLimit.ts          # Rate limit per company+system, configurable per route
│   │   ├── withPlanAccess.ts         # Verifies plan is active and paid, feature is included
│   │   ├── withEntityLimit.ts        # Checks entity count limits from plan + voucher
│   │   └── compose.ts               # Composes multiple middleware into a pipeline
│   ├── utils/
│   │   ├── Core.ts                   # Core singleton — cached config from DB (Section 9)
│   │   ├── fs.ts                     # SurrealFS singleton — shared instance for file operations
│   │   ├── token.ts                  # JWT creation/verification using @panva/jose
│   │   ├── rate-limiter.ts           # In-memory rate limiter with sliding window
│   │   ├── usage-tracker.ts          # Increment usage per user/token/app + company + system
│   │   ├── credit-tracker.ts        # Track daily credit expenses per resource key
│   │   ├── entity-deduplicator.ts    # Checks for duplicate records before creation (Section 10.8)
│   │   ├── field-standardizer.ts     # Standardizes field values by entity+field (Section 10.9)
│   │   ├── field-validator.ts        # Validates field values by entity+field (Section 10.10)
│   │   ├── communication/
│   │   │   └── templates/
│   │   │       ├── verification.ts   # Account verification template
│   │   │       └── password-reset.ts # Password reset template
│   │   └── payment/
│   │       ├── interface.ts          # IPaymentProvider interface
│   │       └── credit-card.ts        # Server-side payment processing
│   ├── event-queue/
│   │   ├── publisher.ts              # publish(name, payload, availableAt?)
│   │   ├── worker.ts                 # Generic worker loop (Section 12)
│   │   ├── registry.ts              # Maps event names → handler names
│   │   └── handlers/
│   │       ├── send-email.ts          # Generic email channel handler
│   │       ├── send-sms.ts            # Generic SMS channel handler
│   │       ├── process-payment.ts
│   │       └── systems/
│   │           └── [system-slug]/
│   │               └── .gitkeep
│   └── jobs/
│       ├── index.ts                  # Starts all jobs
│       ├── start-event-queue.ts      # Initializes workers for all registered handlers
│       └── recurring-billing.ts      # Charges plans at recurrence interval
├── client/                           # Frontend-only code (NEVER imported by server)
│   ├── db/
│   │   └── connection.ts             # SurrealDB frontend connection (WebSocket, user token)
│   ├── queries/                      # Live queries for real-time UI
│   │   └── .gitkeep
│   └── utils/
│       └── payment/
│           ├── interface.ts          # IClientPaymentProvider (tokenization)
│           └── credit-card.ts        # Card tokenization (client-side)
├── public/
│   └── systems/
│       └── [system-slug]/
│           └── logo.svg
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
└── AGENTS.md
```

**Rules:**

- Any empty structural folder contains a `.gitkeep`.
- Adding a new system always creates a subfolder named `[system-slug]` inside:
  `src/components/systems/`, `server/db/migrations/systems/`,
  `server/db/queries/systems/`, `server/db/frontend-queries/systems/`,
  `server/event-queue/handlers/systems/`, `app/api/systems/`, `public/systems/`,
  and within every i18n locale folder under `systems/`.
- **System-specific migrations** live in
  `server/db/migrations/systems/[system-slug]/`. They use the same numeric
  prefix convention as core migrations (e.g. `0026_create_foo.surql`). The
  migration runner scans all system subfolders, merges them with core
  migrations, and sorts by numeric prefix — so ordering is global across core
  and all systems. The migration name stored in `_migrations` includes the
  relative path (e.g. `systems/grex-id/0026_create_face.surql`).

---

## 6. TypeScript Contracts

All contracts live in `src/contracts/`. They are isomorphic — usable by both
frontend and backend.

### 6.1 Common types (`common.ts`)

```typescript
export interface CursorParams {
  cursor?: string; // Opaque cursor from previous page
  limit: number; // 1..200, enforced by backend
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

### 6.2 Profile (`profile.ts`) — Composable entity

```typescript
export interface Profile {
  id: string;
  name: string;
  avatarUri?: string; // File URI from surreal-fs
  age?: number;
  locale?: string; // User's preferred UI/email locale (e.g. "en", "pt-BR")
  createdAt: string;
  updatedAt: string;
}
```

### 6.3 Address (`address.ts`) — Composable entity

```typescript
export interface Address {
  id: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  createdAt: string;
  updatedAt: string;
}
```

### 6.4 User (`user.ts`)

```typescript
export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified?: boolean;
  profile: Profile; // record<profile>, resolved via FETCH
  roles: string[]; // e.g. ["admin", "editor"]
  twoFactorEnabled: boolean;
  oauthProvider?: string;
  stayLoggedIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserCredentials {
  email: string;
  phone?: string;
  password: string; // Stored via SurrealDB crypto::argon2::generate()
}
```

### 6.5 Company (`company.ts`)

```typescript
export interface Company {
  id: string;
  name: string;
  document: string; // e.g. CNPJ for Brazil
  documentType: string; // "cnpj" | "ein" | etc.
  billingAddress?: Address; // record<address>, resolved via FETCH; optional for onboarding
  ownerId: string; // User who created it
  createdAt: string;
  updatedAt: string;
}
```

### 6.6 System (`system.ts`)

```typescript
export interface System {
  id: string;
  name: string;
  slug: string; // URL-safe unique identifier
  logoUri: string; // File URI from surreal-fs
  defaultLocale?: string; // Per-system default locale (no global fallback setting)
  termsOfService?: string; // System-specific LGPD/terms HTML content; if empty, falls back to core generic terms
  createdAt: string;
  updatedAt: string;
}
```

### 6.7 Role (`role.ts`)

```typescript
export interface Role {
  id: string;
  name: string; // i18n key e.g. "roles.admin.name"
  systemId: string;
  permissions: string[]; // Granular permission identifiers
  isBuiltIn: boolean; // "superuser" and "admin" are built-in
  createdAt: string;
}
```

### 6.8 Plan (`plan.ts`)

```typescript
export interface Plan {
  id: string;
  name: string; // i18n key
  description: string; // i18n key
  systemId: string;
  price: number; // In smallest currency unit (cents)
  currency: string;
  recurrenceDays: number; // e.g. 30 for monthly
  benefits: string[]; // Array of i18n keys
  permissions: string[]; // Granular permissions included
  entityLimits?: Record<string, number>; // e.g. { "users": 50, "projects": 10 }
  apiRateLimit: number; // Requests per window — has a default
  storageLimitBytes: number; // Has a default
  planCredits: number; // Temporary credits included per recurrence period (in cents). Resets on renewal. 0 = no included credits.
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 6.9 Voucher (`voucher.ts`)

```typescript
export interface Voucher {
  id: string;
  code: string; // Unique, user-entered
  applicableCompanyIds: string[];
  priceModifier: number; // Positive = discount, negative = surcharge (in cents)
  permissions: string[]; // Additional granular permissions
  entityLimitModifiers?: Record<string, number>; // Additive; positive = increase
  apiRateLimitModifier: number; // Additive
  storageLimitModifier: number; // Additive, in bytes
  expiresAt?: string;
  createdAt: string;
}
```

### 6.10 Menu (`menu.ts`)

```typescript
export interface MenuItem {
  id: string;
  systemId: string;
  parentId?: string; // null for root items
  label: string; // i18n key
  emoji?: string; // Emoji displayed before label
  componentName: string; // Maps to a registered component
  sortOrder: number;
  requiredRoles: string[]; // User needs at least one of these roles
  hiddenInPlanIds: string[]; // Plans where this item is hidden
  children?: MenuItem[]; // Resolved at runtime; unlimited depth
  createdAt: string;
}
```

### 6.11 Billing (`billing.ts`)

```typescript
export interface Subscription {
  id: string;
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId?: string; // Optional for free plans (price = 0)
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherIds: string[];
  remainingPlanCredits: number; // Temporary credits from plan, valid only during current period. Decremented first before purchased credits. Reset to plan.planCredits on renewal.
  creditAlertSent: boolean; // True after the "insufficient credits" email is sent. Reset to false when credits are purchased or plan is renewed.
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  companyId: string;
  type: "credit_card";
  cardMask: string; // e.g. "**** **** **** 4242"
  cardToken: string; // From tokenization provider
  holderName: string;
  holderDocument: string;
  billingAddress: Address; // record<address>, resolved via FETCH
  isDefault: boolean;
  createdAt: string;
}

export interface CreditPurchase {
  id: string;
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}
```

### 6.12 Connected App (`connected-app.ts`)

```typescript
export interface ConnectedApp {
  id: string;
  name: string;
  companyId: string;
  systemId: string;
  permissions: string[];
  monthlySpendLimit?: number; // Optional spend cap (in cents)
  createdAt: string;
}
```

### 6.13 Token (`token.ts`)

```typescript
export interface ApiToken {
  id: string;
  userId: string;
  companyId: string;
  systemId: string;
  name: string;
  description?: string;
  tokenHash: string; // Stored hashed; raw shown once at creation
  permissions: string[];
  monthlySpendLimit?: number;
  expiresAt?: string;
  createdAt: string;
}
```

### 6.14 File Metadata (`file.ts`)

File metadata is stored entirely within `@hviana/surreal-fs` via the `metadata`
parameter of `fs.save()`. There is no separate `file_metadata` SQL table — the
library handles persistence internally.

```typescript
export interface FileMetadata {
  id: string;
  companyId: string;
  systemSlug: string;
  userId: string;
  category: string[]; // Multi-level path segments (e.g. ["documents", "invoices"])
  fileName: string;
  fileUuid: string; // crypto.randomUUID()
  uri: string; // surreal-fs path: {companyId}/{systemSlug}/{userId}/{...category}/{uuid}/{fileName}
  sizeBytes: number;
  mimeType: string;
  description?: string;
  createdAt: string;
}
```

### 6.15 Event Queue (`event-queue.ts`)

```typescript
export interface QueueEvent {
  id: string;
  name: string; // Event name e.g. "SEND_EMAIL"
  payload: Record<string, unknown>;
  availableAt: string; // ISO datetime — immediate = now()
  createdAt: string;
}

export interface Delivery {
  id: string;
  eventId: string;
  handler: string; // Handler name e.g. "send_email"
  status: "pending" | "processing" | "done" | "dead";
  availableAt: string;
  leaseUntil?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  workerId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkerConfig {
  handler: string;
  maxConcurrency: number; // Max parallel executions
  batchSize: number; // Max deliveries fetched per cycle
  leaseDurationMs: number; // Lease duration in milliseconds
  idleDelayMs: number; // Delay when queue is empty
  retryBackoffBaseMs: number; // Base for exponential backoff
  maxAttempts: number;
}
```

### 6.16 Communication (`communication.ts`)

Communication has no provider abstraction. All sending is done directly inside
event handlers — each handler is responsible for resolving templates, reading
Core settings, and calling the external service (email API, SMS gateway, etc.).
Entities that need to send communication simply publish events with the
parameters they need; the handler does the rest.

```typescript
// Templates return a body (HTML or plain text) and an optional title (e.g. email subject)
export interface TemplateResult {
  body: string;
  title?: string;
}

export type TemplateFunction = (
  locale: string,
  data: Record<string, string>,
) => TemplateResult;
```

### 6.17 Payment Provider (`payment-provider.ts`)

```typescript
// --- Server-side ---
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
}

// --- Client-side ---
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

### 6.18 Usage (`usage.ts`)

```typescript
export interface UsageRecord {
  id: string;
  companyId: string;
  systemId: string;
  actorType: "user" | "token" | "connected_app";
  actorId: string;
  resource: string; // e.g. "storage_bytes"
  value: number;
  period: string; // "YYYY-MM" for monthly aggregation
  createdAt: string;
}

/**
 * Tracks daily credit expenses per resource key.
 * Each resource that consumes credits is identified by an i18n key
 * (e.g. "billing.credits.resource.faceDetection",
 *       "billing.credits.resource.ocrScan").
 * The expense tracker increments the value for a given resource key
 * on the current day's container. Monthly expense is the sum of all
 * daily containers over the last 31 days.
 */
export interface CreditExpense {
  id: string;
  companyId: string;
  systemId: string;
  resourceKey: string; // i18n key identifying the resource (e.g. "billing.credits.resource.faceDetection")
  amount: number; // Monetary value in smallest currency unit (cents)
  day: string; // "YYYY-MM-DD" — daily container
  createdAt: string;
}
```

### 6.19 Core Settings (`core-settings.ts`)

```typescript
export interface CoreSetting {
  id: string;
  key: string; // Unique
  value: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
```

### 6.20 Tag (`tag.ts`)

```typescript
export interface Tag {
  id: string;
  name: string;
  color: string; // Hex color e.g. "#ff5733"
  companyId: string;
  systemId: string;
  createdAt: string;
}
```

### 6.21 Lead (`lead.ts`)

```typescript
export interface Lead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  profile: Profile; // record<profile>, resolved via FETCH
  tags: string[]; // Array of tag record IDs
  createdAt: string;
  updatedAt: string;
}

export interface LeadCompanySystem {
  id: string;
  leadId: string;
  companyId: string;
  systemId: string;
  ownerId?: string;
  createdAt: string;
}
```

### 6.22 Location (`location.ts`)

```typescript
export interface Location {
  id: string;
  name: string;
  description?: string;
  companyId: string;
  systemId: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. Database Schema (SurrealDB)

All tables are `SCHEMAFULL`. Passwords are stored and verified using SurrealDB's
built-in `crypto::argon2::generate()` and `crypto::argon2::compare()`.

### 7.1 Migration system

File: `server/db/migrations/runner.ts`

A `_migrations` table tracks applied migrations:

```surql
DEFINE TABLE _migrations SCHEMAFULL;
DEFINE FIELD name ON _migrations TYPE string;
DEFINE FIELD appliedAt ON _migrations TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_migrations_name ON _migrations FIELDS name UNIQUE;
```

The runner reads `.surql` files from the root migrations directory **and** from
`systems/[system-slug]/` subfolders, merges them, sorts by numeric prefix
globally, skips those already in `_migrations`, executes pending ones inside a
transaction, and records them. System-specific migration names are stored with
their relative path (e.g. `systems/grex-id/0026_create_face.surql`).

### 7.2 Seed system

File: `server/db/seeds/runner.ts`

Each seed file exports an async function that checks for existing data before
inserting. Example: superuser seed checks
`SELECT * FROM user WHERE roles CONTAINS "superuser"` before creating.

### 7.3 Tables and indexes

Below is the logical schema. Each maps to a numbered migration file.

#### profile (composable)

```surql
DEFINE TABLE profile SCHEMAFULL;
DEFINE FIELD name      ON profile TYPE string;
DEFINE FIELD avatarUri ON profile TYPE option<string>;
DEFINE FIELD age       ON profile TYPE option<int>;
DEFINE FIELD locale    ON profile TYPE option<string>;
DEFINE FIELD createdAt ON profile TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt ON profile TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_profile_name ON TABLE profile FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
```

#### address (composable)

```surql
DEFINE TABLE address SCHEMAFULL;
DEFINE FIELD street       ON address TYPE string;
DEFINE FIELD number       ON address TYPE string;
DEFINE FIELD complement   ON address TYPE option<string>;
DEFINE FIELD neighborhood ON address TYPE option<string>;
DEFINE FIELD city         ON address TYPE string;
DEFINE FIELD state        ON address TYPE string;
DEFINE FIELD country      ON address TYPE string;
DEFINE FIELD postalCode   ON address TYPE string;
DEFINE FIELD createdAt    ON address TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt    ON address TYPE datetime DEFAULT time::now();
```

#### user

```surql
DEFINE TABLE user SCHEMAFULL;
DEFINE FIELD email        ON user TYPE string  ASSERT string::is_email($value);
DEFINE FIELD emailVerified ON user TYPE bool   DEFAULT false;
DEFINE FIELD phone        ON user TYPE option<string>;
DEFINE FIELD phoneVerified ON user TYPE bool   DEFAULT false;
DEFINE FIELD passwordHash ON user TYPE string;
DEFINE FIELD profile      ON user TYPE record<profile>;
DEFINE FIELD roles        ON user TYPE array<string>;
DEFINE FIELD twoFactorEnabled ON user TYPE bool DEFAULT false;
DEFINE FIELD twoFactorSecret  ON user TYPE option<string>;
DEFINE FIELD oauthProvider    ON user TYPE option<string>;
DEFINE FIELD stayLoggedIn     ON user TYPE bool DEFAULT false;
DEFINE FIELD createdAt    ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt    ON user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_user_email ON user FIELDS email UNIQUE;
DEFINE INDEX idx_user_phone ON user FIELDS phone UNIQUE;
DEFINE INDEX idx_user_roles ON user FIELDS roles;
```

#### company

```surql
DEFINE TABLE company SCHEMAFULL;
DEFINE FIELD name           ON company TYPE string;
DEFINE FIELD document       ON company TYPE string;
DEFINE FIELD documentType   ON company TYPE string;
DEFINE FIELD billingAddress ON company TYPE option<record<address>>;
DEFINE FIELD ownerId        ON company TYPE record<user>;
DEFINE FIELD createdAt      ON company TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt     ON company TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_company_name     ON TABLE company FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_company_document ON company FIELDS document UNIQUE;
DEFINE INDEX idx_company_owner    ON company FIELDS ownerId;
```

#### company_user (association)

```surql
DEFINE TABLE company_user SCHEMAFULL;
DEFINE FIELD companyId  ON company_user TYPE record<company>;
DEFINE FIELD userId     ON company_user TYPE record<user>;
DEFINE FIELD createdAt  ON company_user TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cu_unique ON company_user FIELDS companyId, userId UNIQUE;
DEFINE INDEX idx_cu_user   ON company_user FIELDS userId;
```

#### system

```surql
DEFINE TABLE system SCHEMAFULL;
DEFINE FIELD name          ON system TYPE string;
DEFINE FIELD slug          ON system TYPE string;
DEFINE FIELD logoUri       ON system TYPE string;
DEFINE FIELD defaultLocale  ON system TYPE option<string>;
DEFINE FIELD termsOfService ON system TYPE option<string>;
DEFINE FIELD createdAt      ON system TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt      ON system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_system_slug ON system FIELDS slug UNIQUE;
DEFINE INDEX idx_system_name ON TABLE system FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
```

#### company_system (association)

```surql
DEFINE TABLE company_system SCHEMAFULL;
DEFINE FIELD companyId ON company_system TYPE record<company>;
DEFINE FIELD systemId  ON company_system TYPE record<system>;
DEFINE FIELD createdAt ON company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_unique ON company_system FIELDS companyId, systemId UNIQUE;
```

#### user_company_system (user context association)

```surql
DEFINE TABLE user_company_system SCHEMAFULL;
DEFINE FIELD userId    ON user_company_system TYPE record<user>;
DEFINE FIELD companyId ON user_company_system TYPE record<company>;
DEFINE FIELD systemId  ON user_company_system TYPE record<system>;
DEFINE FIELD roles     ON user_company_system TYPE array<string>;
DEFINE FIELD createdAt ON user_company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ucs_unique  ON user_company_system FIELDS userId, companyId, systemId UNIQUE;
DEFINE INDEX idx_ucs_user    ON user_company_system FIELDS userId;
DEFINE INDEX idx_ucs_company ON user_company_system FIELDS companyId;
```

#### role

```surql
DEFINE TABLE role SCHEMAFULL;
DEFINE FIELD name        ON role TYPE string;
DEFINE FIELD systemId    ON role TYPE record<system>;
DEFINE FIELD permissions ON role TYPE array<string>;
DEFINE FIELD isBuiltIn   ON role TYPE bool DEFAULT false;
DEFINE FIELD createdAt   ON role TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_role_system      ON role FIELDS systemId;
DEFINE INDEX idx_role_name_system ON role FIELDS name, systemId UNIQUE;
```

#### plan

```surql
DEFINE TABLE plan SCHEMAFULL;
DEFINE FIELD name             ON plan TYPE string;
DEFINE FIELD description      ON plan TYPE string;
DEFINE FIELD systemId         ON plan TYPE record<system>;
DEFINE FIELD price            ON plan TYPE int;
DEFINE FIELD currency         ON plan TYPE string DEFAULT "USD";
DEFINE FIELD recurrenceDays   ON plan TYPE int;
DEFINE FIELD benefits         ON plan TYPE array<string>;
DEFINE FIELD permissions      ON plan TYPE array<string>;
DEFINE FIELD entityLimits     ON plan TYPE option<object> FLEXIBLE;
DEFINE FIELD apiRateLimit     ON plan TYPE int DEFAULT 1000;
DEFINE FIELD storageLimitBytes ON plan TYPE int DEFAULT 1073741824; -- 1GB
DEFINE FIELD planCredits      ON plan TYPE int DEFAULT 0; -- Temporary credits per recurrence period (cents)
DEFINE FIELD isActive         ON plan TYPE bool DEFAULT true;
DEFINE FIELD createdAt        ON plan TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt        ON plan TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_plan_system ON plan FIELDS systemId;
DEFINE INDEX idx_plan_active ON plan FIELDS systemId, isActive;
```

#### voucher

```surql
DEFINE TABLE voucher SCHEMAFULL;
DEFINE FIELD code                  ON voucher TYPE string;
DEFINE FIELD applicableCompanyIds  ON voucher TYPE array<record<company>>;
DEFINE FIELD priceModifier         ON voucher TYPE int;
DEFINE FIELD permissions           ON voucher TYPE array<string>;
DEFINE FIELD entityLimitModifiers  ON voucher TYPE option<object> FLEXIBLE;
DEFINE FIELD apiRateLimitModifier  ON voucher TYPE int DEFAULT 0;
DEFINE FIELD storageLimitModifier  ON voucher TYPE int DEFAULT 0;
DEFINE FIELD expiresAt             ON voucher TYPE option<datetime>;
DEFINE FIELD createdAt             ON voucher TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_voucher_code ON voucher FIELDS code UNIQUE;
```

#### menu_item

```surql
DEFINE TABLE menu_item SCHEMAFULL;
DEFINE FIELD systemId       ON menu_item TYPE record<system>;
DEFINE FIELD parentId       ON menu_item TYPE option<record<menu_item>>;
DEFINE FIELD label          ON menu_item TYPE string;
DEFINE FIELD emoji          ON menu_item TYPE option<string>;
DEFINE FIELD componentName  ON menu_item TYPE string;
DEFINE FIELD sortOrder      ON menu_item TYPE int DEFAULT 0;
DEFINE FIELD requiredRoles  ON menu_item TYPE array<string>;
DEFINE FIELD hiddenInPlanIds ON menu_item TYPE array<record<plan>>;
DEFINE FIELD createdAt      ON menu_item TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_menu_system    ON menu_item FIELDS systemId;
DEFINE INDEX idx_menu_parent    ON menu_item FIELDS parentId;
DEFINE INDEX idx_menu_sort      ON menu_item FIELDS systemId, parentId, sortOrder;
```

#### subscription

```surql
DEFINE TABLE subscription SCHEMAFULL;
DEFINE FIELD companyId          ON subscription TYPE record<company>;
DEFINE FIELD systemId           ON subscription TYPE record<system>;
DEFINE FIELD planId             ON subscription TYPE record<plan>;
DEFINE FIELD paymentMethodId    ON subscription TYPE option<record<payment_method>>;
DEFINE FIELD status             ON subscription TYPE string
  ASSERT $value IN ["active", "past_due", "cancelled"];
DEFINE FIELD currentPeriodStart ON subscription TYPE datetime;
DEFINE FIELD currentPeriodEnd   ON subscription TYPE datetime;
DEFINE FIELD voucherIds            ON subscription TYPE array<record<voucher>>;
DEFINE FIELD remainingPlanCredits  ON subscription TYPE int DEFAULT 0;
DEFINE FIELD creditAlertSent       ON subscription TYPE bool DEFAULT false;
DEFINE FIELD createdAt             ON subscription TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_sub_company_system ON subscription FIELDS companyId, systemId;
DEFINE INDEX idx_sub_status         ON subscription FIELDS status;
DEFINE INDEX idx_sub_period_end     ON subscription FIELDS currentPeriodEnd;
```

#### payment_method

```surql
DEFINE TABLE payment_method SCHEMAFULL;
DEFINE FIELD companyId       ON payment_method TYPE record<company>;
DEFINE FIELD type            ON payment_method TYPE string DEFAULT "credit_card";
DEFINE FIELD cardMask        ON payment_method TYPE string;
DEFINE FIELD cardToken       ON payment_method TYPE string;
DEFINE FIELD holderName      ON payment_method TYPE string;
DEFINE FIELD holderDocument  ON payment_method TYPE string;
DEFINE FIELD billingAddress  ON payment_method TYPE record<address>;
DEFINE FIELD isDefault       ON payment_method TYPE bool DEFAULT false;
DEFINE FIELD createdAt       ON payment_method TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_pm_company ON payment_method FIELDS companyId;
```

#### credit_purchase

```surql
DEFINE TABLE credit_purchase SCHEMAFULL;
DEFINE FIELD companyId       ON credit_purchase TYPE record<company>;
DEFINE FIELD systemId        ON credit_purchase TYPE record<system>;
DEFINE FIELD amount          ON credit_purchase TYPE int;
DEFINE FIELD paymentMethodId ON credit_purchase TYPE record<payment_method>;
DEFINE FIELD status          ON credit_purchase TYPE string
  ASSERT $value IN ["pending", "completed", "failed"];
DEFINE FIELD createdAt       ON credit_purchase TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cp_company_system ON credit_purchase FIELDS companyId, systemId;
```

#### connected_app

```surql
DEFINE TABLE connected_app SCHEMAFULL;
DEFINE FIELD name            ON connected_app TYPE string;
DEFINE FIELD companyId       ON connected_app TYPE record<company>;
DEFINE FIELD systemId        ON connected_app TYPE record<system>;
DEFINE FIELD permissions     ON connected_app TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON connected_app TYPE option<int>;
DEFINE FIELD createdAt       ON connected_app TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ca_company_system ON connected_app FIELDS companyId, systemId;
```

#### api_token

```surql
DEFINE TABLE api_token SCHEMAFULL;
DEFINE FIELD userId          ON api_token TYPE record<user>;
DEFINE FIELD companyId       ON api_token TYPE record<company>;
DEFINE FIELD systemId        ON api_token TYPE record<system>;
DEFINE FIELD name            ON api_token TYPE string;
DEFINE FIELD description     ON api_token TYPE option<string>;
DEFINE FIELD tokenHash       ON api_token TYPE string;
DEFINE FIELD permissions     ON api_token TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON api_token TYPE option<int>;
DEFINE FIELD expiresAt       ON api_token TYPE option<datetime>;
DEFINE FIELD createdAt       ON api_token TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_at_hash           ON api_token FIELDS tokenHash UNIQUE;
DEFINE INDEX idx_at_user_company   ON api_token FIELDS userId, companyId, systemId;
```

#### file_metadata

File metadata is managed entirely by `@hviana/surreal-fs` (stored in the
`metadata` field of `surreal_fs_files`). No separate `file_metadata` table is
needed — the library creates and manages its own `surreal_fs_files` and
`surreal_fs_chunks` tables automatically via `fs.init()`.

#### usage_record

```surql
DEFINE TABLE usage_record SCHEMAFULL;
DEFINE FIELD companyId   ON usage_record TYPE record<company>;
DEFINE FIELD systemId    ON usage_record TYPE record<system>;
DEFINE FIELD actorType   ON usage_record TYPE string
  ASSERT $value IN ["user", "token", "connected_app"];
DEFINE FIELD actorId     ON usage_record TYPE string;
DEFINE FIELD resource    ON usage_record TYPE string;
DEFINE FIELD value       ON usage_record TYPE number;
DEFINE FIELD period      ON usage_record TYPE string;
DEFINE FIELD createdAt   ON usage_record TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ur_actor   ON usage_record FIELDS actorType, actorId, resource, period;
DEFINE INDEX idx_ur_company ON usage_record FIELDS companyId, systemId, resource, period;
```

#### credit_expense

```surql
DEFINE TABLE credit_expense SCHEMAFULL;
DEFINE FIELD companyId    ON credit_expense TYPE record<company>;
DEFINE FIELD systemId     ON credit_expense TYPE record<system>;
DEFINE FIELD resourceKey  ON credit_expense TYPE string;
DEFINE FIELD amount       ON credit_expense TYPE number;
DEFINE FIELD day          ON credit_expense TYPE string;
DEFINE FIELD createdAt    ON credit_expense TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ce_company_day ON credit_expense FIELDS companyId, systemId, day;
DEFINE INDEX idx_ce_resource    ON credit_expense FIELDS companyId, systemId, resourceKey, day UNIQUE;
```

#### queue_event

```surql
DEFINE TABLE queue_event SCHEMAFULL;
DEFINE FIELD name        ON queue_event TYPE string;
DEFINE FIELD payload ON queue_event TYPE object FLEXIBLE;
DEFINE FIELD availableAt ON queue_event TYPE datetime;
DEFINE FIELD createdAt   ON queue_event TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_qe_available       ON queue_event FIELDS availableAt;
DEFINE INDEX idx_qe_name_available  ON queue_event FIELDS name, availableAt;
```

#### delivery

```surql
DEFINE TABLE delivery SCHEMAFULL;
DEFINE FIELD eventId     ON delivery TYPE record<queue_event>;
DEFINE FIELD handler     ON delivery TYPE string;
DEFINE FIELD status      ON delivery TYPE string
  ASSERT $value IN ["pending", "processing", "done", "dead"];
DEFINE FIELD availableAt ON delivery TYPE datetime;
DEFINE FIELD leaseUntil  ON delivery TYPE option<datetime>;
DEFINE FIELD attempts    ON delivery TYPE int DEFAULT 0;
DEFINE FIELD maxAttempts ON delivery TYPE int DEFAULT 5;
DEFINE FIELD lastError   ON delivery TYPE option<string>;
DEFINE FIELD workerId    ON delivery TYPE option<string>;
DEFINE FIELD createdAt   ON delivery TYPE datetime DEFAULT time::now();
DEFINE FIELD startedAt   ON delivery TYPE option<datetime>;
DEFINE FIELD finishedAt  ON delivery TYPE option<datetime>;

DEFINE INDEX idx_del_claim ON delivery FIELDS handler, status, availableAt, leaseUntil;
DEFINE INDEX idx_del_event_handler ON delivery FIELDS eventId, handler UNIQUE;
DEFINE INDEX idx_del_status_available ON delivery FIELDS status, availableAt;
```

#### core_setting

```surql
DEFINE TABLE core_setting SCHEMAFULL;
DEFINE FIELD key         ON core_setting TYPE string;
DEFINE FIELD value       ON core_setting TYPE string;
DEFINE FIELD description ON core_setting TYPE string;
DEFINE FIELD createdAt   ON core_setting TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt   ON core_setting TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_cs_key ON core_setting FIELDS key UNIQUE;
```

#### verification_request (for email/SMS verification and password reset)

```surql
DEFINE TABLE verification_request SCHEMAFULL;
DEFINE FIELD userId     ON verification_request TYPE record<user>;
DEFINE FIELD type       ON verification_request TYPE string
  ASSERT $value IN ["email_verify", "phone_verify", "password_reset"];
DEFINE FIELD token      ON verification_request TYPE string;
DEFINE FIELD expiresAt  ON verification_request TYPE datetime;
DEFINE FIELD usedAt     ON verification_request TYPE option<datetime>;
DEFINE FIELD createdAt  ON verification_request TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_vr_token    ON verification_request FIELDS token UNIQUE;
DEFINE INDEX idx_vr_user     ON verification_request FIELDS userId, type, createdAt;
```

#### tag

```surql
DEFINE TABLE tag SCHEMAFULL;
DEFINE FIELD name      ON tag TYPE string;
DEFINE FIELD color     ON tag TYPE string;
DEFINE FIELD companyId ON tag TYPE record<company>;
DEFINE FIELD systemId  ON tag TYPE record<system>;
DEFINE FIELD createdAt ON tag TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_tag_company_system      ON tag FIELDS companyId, systemId;
DEFINE INDEX idx_tag_name_company_system ON tag FIELDS name, companyId, systemId UNIQUE;
DEFINE INDEX idx_tag_name                ON TABLE tag FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
```

#### lead

```surql
DEFINE TABLE lead SCHEMAFULL;
DEFINE FIELD name          ON lead TYPE string;
DEFINE FIELD email         ON lead TYPE string ASSERT string::is_email($value);
DEFINE FIELD phone         ON lead TYPE option<string>;
DEFINE FIELD profile       ON lead TYPE record<profile>;
DEFINE FIELD tags          ON lead TYPE array<record<tag>> DEFAULT [];
DEFINE FIELD createdAt     ON lead TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt     ON lead TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lead_email ON lead FIELDS email UNIQUE;
DEFINE INDEX idx_lead_phone ON lead FIELDS phone UNIQUE;
DEFINE INDEX idx_lead_name  ON TABLE lead FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
```

#### lead_company_system (association)

```surql
DEFINE TABLE lead_company_system SCHEMAFULL;
DEFINE FIELD leadId    ON lead_company_system TYPE record<lead>;
DEFINE FIELD companyId ON lead_company_system TYPE record<company>;
DEFINE FIELD systemId  ON lead_company_system TYPE record<system>;
DEFINE FIELD ownerId   ON lead_company_system TYPE option<record<user>>;
DEFINE FIELD createdAt ON lead_company_system TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_lcs_unique  ON lead_company_system FIELDS leadId, companyId, systemId UNIQUE;
DEFINE INDEX idx_lcs_company ON lead_company_system FIELDS companyId, systemId;
```

#### location

```surql
DEFINE TABLE location SCHEMAFULL;
DEFINE FIELD name             ON location TYPE string;
DEFINE FIELD description      ON location TYPE option<string>;
DEFINE FIELD companyId        ON location TYPE record<company>;
DEFINE FIELD systemId         ON location TYPE record<system>;
DEFINE FIELD address          ON location TYPE object;
DEFINE FIELD address.street   ON location TYPE string;
DEFINE FIELD address.number   ON location TYPE string;
DEFINE FIELD address.complement    ON location TYPE option<string>;
DEFINE FIELD address.neighborhood  ON location TYPE option<string>;
DEFINE FIELD address.city     ON location TYPE string;
DEFINE FIELD address.state    ON location TYPE string;
DEFINE FIELD address.country  ON location TYPE string;
DEFINE FIELD address.postalCode ON location TYPE string;
DEFINE FIELD createdAt        ON location TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt        ON location TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_location_company ON location FIELDS companyId, systemId;
DEFINE INDEX idx_location_name    ON TABLE location FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
```

### 7.4 Live Query Permissions

Frontend live queries use SurrealDB's `DEFINE ACCESS` and
`DEFINE TABLE ... PERMISSIONS` to enforce access control at the schema level.
The user token issued by SurrealDB carries `$auth.id`.

```surql
-- Example: restrict live selects so users only see their own data
DEFINE TABLE notification SCHEMAFULL
  PERMISSIONS
    FOR select WHERE userId = $auth.id
    FOR create NONE
    FOR update NONE
    FOR delete NONE;
```

**Rules for frontend queries:**

- Only `LIVE SELECT` is allowed.
- All tables used by frontend queries must have
  `PERMISSIONS FOR select WHERE ...` that restricts to the authenticated user's
  records.
- Always include `WHERE user = $auth.id` (or equivalent ownership check) in the
  schema permission.
- Always use cursor-based pagination with a reasonable limit.
- The access token used in frontend WebSocket connections is a SurrealDB
  user-scoped token, not the system API token.

---

## 8. Authentication System

### 8.1 Dual token architecture

| Token                | Purpose                                    | Issued by                                 | Transport                              |
| -------------------- | ------------------------------------------ | ----------------------------------------- | -------------------------------------- |
| System API Token     | Authenticate API requests (backend routes) | Backend, via `@panva/jose`                | `Authorization: Bearer <token>` header |
| SurrealDB User Token | Frontend live queries via WebSocket        | SurrealDB `DEFINE ACCESS ... TYPE RECORD` | WebSocket auth on connect              |

Both tokens are refreshed when pertinent: the system token via a
`/api/auth/refresh` endpoint; the SurrealDB token by re-authenticating the
WebSocket connection.

### 8.1.1 System branding on public pages

All unauthenticated pages (homepage, login, register, forgot-password,
reset-password, verify) receive the system context via a `?system=<slug>` query
parameter. When present, the page fetches the system's public info
(`/api/public/system?slug=<slug>`) and displays the system logo and name in the
header area above the form. Auth page links (login ↔ register, forgot-password →
login, etc.) preserve the `?system=` parameter so branding remains consistent
across the entire unauthenticated flow.

If no `?system=` parameter is present, the pages show the core application name
(`app.name` setting) without a logo.

### 8.2 Registration flow

1. User submits email, password, optional phone. Bot protection challenge is
   validated. **Terms of acceptance checkbox must be checked** (Section 19).
2. Backend validates `termsAccepted: true` in the request body; rejects with
   `validation.terms.required` if missing.
3. Backend checks rate limit (aggressive on auth routes).
4. Password is stored using `crypto::argon2::generate(password)` inside
   SurrealDB.
5. A `verification_request` record is created with a secure random token and an
   expiration (e.g. 15 minutes).
6. A verification email/SMS is sent via the event queue (`SEND_EMAIL` /
   `SEND_SMS` event with the verification template).
7. User cannot log in until `emailVerified = true` (or `phoneVerified = true` if
   phone-only).

### 8.3 Login flow

1. Bot protection challenge is validated.
2. Rate limit check (aggressive).
3. Fetch user by email; verify password with `crypto::argon2::compare()`.
4. If `emailVerified = false` → reject with "account not verified" error.
5. If `twoFactorEnabled = true` → require 2FA code before issuing tokens.
6. Issue System API Token (short-lived, e.g. 15 min; longer if `stayLoggedIn`).
7. Issue SurrealDB User Token for frontend WebSocket.
8. Return both tokens to client.

### 8.3.1 Post-login routing

After login succeeds, the frontend checks the user's roles and onboarding state
and redirects accordingly:

1. **Superuser:** Redirect to `/systems` (core admin panel). Superusers always
   go to the core panel — they skip the regular onboarding flow entirely.
2. **No companies:** Redirect to `/onboarding/company` — the user must register
   at least one company before proceeding.
3. **Has companies but no system subscriptions:** Redirect to
   `/onboarding/system` — the user must associate at least one company with a
   system by subscribing to a plan. The onboarding system page is a **two-step
   flow**: (1) select a system, (2) select a plan for that system. On submit,
   the frontend calls `POST /api/billing` with `action: "subscribe"`, which
   creates the `company_system` association and the subscription in one batched
   query (see Section 17.1). Free plans (price = 0) do not require a payment
   method.
4. **Onboarding complete (at least one company with an active subscription):**
   Redirect to `/entry` — a lightweight spinner-only page inside the `(app)`
   route group. The layout loads menus and navigates to the first menu item's
   component (see Section 12.12.1 initial page rule). `/entry` never renders
   real content; it exists solely as a landing pad.

The `(app)` layout checks the user's system associations via
`GET /api/companies/{companyId}/systems`. If the response is empty, it redirects
to `/onboarding/system`.

The usage page always opens with a **default context**: the user's first
registered company and that company's first subscribed system. This default
context is resolved by the `(app)` layout on mount.

### 8.3.2 Company and system switching

Once the onboarding flow has been completed at least once, the user can switch
between their companies and systems at any time via the **ProfileMenu** dropdown
in the top bar. The ProfileMenu displays:

- The current company displayed via a `SearchableSelectField`
  (`multiple={false}`, `showAllOnEmpty`) that lists all companies the user
  belongs to. The selected company appears as a badge. The `fetchFn` filters the
  local array.
- The current system displayed via a `SearchableSelectField`
  (`multiple={false}`, `showAllOnEmpty`) that lists all systems the selected
  company is subscribed to (filtered by active subscriptions). The `fetchFn`
  filters the local array.

Changing the company resets the system selector to the first system of the newly
selected company. Changing company or system updates `useSystemContext`, reloads
the sidebar menus, usage data, and all context-dependent UI, and navigates to
the first menu item's component (see Section 12.12.1 initial page rule).

### 8.4 Password recovery flow

1. User enters email/phone. Bot protection validated. Rate limit check.
2. Backend checks cooldown: no new request if one was sent within the safe
   interval (e.g. 2 minutes).
3. Create `verification_request` with type `password_reset`, secure token,
   expiration (e.g. 30 min).
4. Send password reset link via email/SMS through event queue.
5. User clicks link → `reset-password` page validates token → user enters new
   password → backend updates `passwordHash` and marks request as used.

### 8.5 OAuth flow (if enabled in core settings)

1. Redirect to OAuth provider.
2. On callback, verify the OAuth token, extract email.
3. If user exists with that email → link OAuth provider, issue tokens.
4. If user does not exist → create user with `emailVerified = true` (trusted
   from OAuth provider), issue tokens.

### 8.6 Security measures

- **Rate limiting:** Auth routes use a tighter rate limit (e.g. 5 requests/min
  per IP) than general API routes.
- **Bot protection:** `BotProtection.tsx` component renders a challenge (CAPTCHA
  or equivalent) on login, register, forgot-password pages. The backend verifies
  the challenge token.
- **Verification cooldown:** Minimum interval between verification/reset emails
  per user (e.g. 120 seconds), enforced by checking `createdAt` of the latest
  `verification_request`.
- **Token expiration:** Reset tokens expire within a secure window (e.g. 30
  min). System API tokens are short-lived. `stayLoggedIn` extends the system
  token lifetime.
- **2FA:** Optional per user. When enabled, login requires a TOTP code after
  password verification. Can be enabled/disabled globally in core settings.
- **OAuth:** Toggle per system in core settings. When enabled, the login page
  shows OAuth provider buttons.

---

## 9. Core Singleton (`server/utils/Core.ts`)

The `Core` class is a server-only singleton that caches all core configuration
from the database.

### 9.1 Contract

```typescript
class Core {
  // Static database connection info (never changes)
  private static readonly DB_URL: string; // From environment
  private static readonly DB_USER: string;
  private static readonly DB_PASS: string;
  private static readonly DB_NAMESPACE: string;
  private static readonly DB_DATABASE: string;

  // Cached data (reloaded on change)
  systems: System[];
  roles: Role[];
  plans: Plan[];
  menus: MenuItem[];
  settings: Map<string, CoreSetting>;

  // Vouchers are NOT cached (queried on demand)

  // Missing settings log — tracks keys requested via getSetting()
  // that were not found in the DB. Cleared per key on reload when defined.
  getMissingSettings(): MissingSetting[];
  // MissingSetting: { key, firstRequestedAt }

  async load(): Promise<void>; // Loads all data from DB
  async reload(): Promise<void>; // Called when core settings change

  static getInstance(): Core;
}
```

### 9.2 Server-only guard

The `Core` class file includes a runtime check:

```typescript
if (typeof window !== "undefined") {
  throw new Error("Core must not be imported in client-side code.");
}
```

This prevents accidental frontend import that would expose sensitive data.

### 9.3 Reload trigger

Whenever a core entity is created/updated/deleted via API (systems, roles,
plans, menus, settings), the corresponding route handler calls
`Core.getInstance().reload()`.

### 9.4 Core settings reference

All server-side code reads configuration exclusively via
`Core.getInstance().getSetting(key)`. There are no hardcoded fallback constants
— if a setting is not defined in the database, `getSetting()` returns
`undefined` and the missing key is logged (see Section 9.5). All settings must
be seeded by `server/db/seeds/002_default_settings.ts` and are editable in the
superuser settings panel.

| Key                                      | Seed value                                 | Used by                                                                                 |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `app.name`                               | `"Core"`                                   | Welcome email template (`appName` parameter)                                            |
| `app.baseUrl`                            | `"http://localhost:3000"`                  | Verification/reset links in emails                                                      |
| `app.defaultSystem`                      | `""`                                       | System slug shown on homepage when no `?system=` param                                  |
| `auth.token.expiry.minutes`              | `"15"`                                     | System API token lifetime                                                               |
| `auth.token.expiry.stayLoggedIn.hours`   | `"168"`                                    | Token lifetime when stay-logged-in is on (7 days)                                       |
| `auth.rateLimit.perMinute`               | `"5"`                                      | Auth route rate limiting (login, register, forgot-password)                             |
| `auth.verification.expiry.minutes`       | `"15"`                                     | Email verification link expiry                                                          |
| `auth.passwordReset.expiry.minutes`      | `"30"`                                     | Password reset link expiry                                                              |
| `auth.verification.cooldown.seconds`     | `"120"`                                    | Min interval between verification/reset emails per user                                 |
| `auth.twoFactor.enabled`                 | `"true"`                                   | Global toggle for 2FA (if `"false"`, 2FA is skipped at login)                           |
| `auth.oauth.enabled`                     | `"false"`                                  | Global toggle for OAuth providers                                                       |
| `auth.oauth.providers`                   | `"[]"`                                     | JSON array of enabled OAuth provider names                                              |
| `communication.email.provider`           | `""`                                       | Email service configuration (JSON)                                                      |
| `communication.email.senders`            | `'["noreply@core.com"]'`                   | Default email sender addresses (JSON array)                                             |
| `communication.sms.provider`             | `""`                                       | SMS service configuration (JSON)                                                        |
| `payment.provider`                       | `""`                                       | Payment gateway configuration (JSON)                                                    |
| `files.maxUploadSizeBytes`               | `"52428800"`                               | Maximum file upload size (50 MB)                                                        |
| `files.publicUpload.rateLimit.perMinute` | `"3"`                                      | Very strict rate limit for unauthenticated uploads per IP                               |
| `files.publicUpload.maxSizeBytes`        | `"2097152"`                                | Max file size for unauthenticated uploads (2 MB)                                        |
| `files.publicUpload.allowedExtensions`   | `'[".svg",".png",".jpg",".jpeg",".webp"]'` | Allowed extensions for unauthenticated uploads                                          |
| `files.publicUpload.allowedPathPatterns` | `'["*/*/*/logos/*"]'`                      | Glob patterns for allowed unauthenticated upload paths                                  |
| `terms.generic`                          | `""`                                       | Generic LGPD/terms of service HTML content (fallback when system has no specific terms) |

### 9.5 Missing settings log

When `getSetting()` is called for a key not in the DB, Core records the key and
a timestamp. On `reload()`, any key that has since been defined is removed from
the log.

The superuser settings panel (`/api/core/settings/missing`) fetches this log and
renders a warning banner listing every undefined key. An "Add all missing"
button pre-fills them as new rows in the settings editor so the superuser can
fill in values and save in one step.

---

## 10. Backend Architecture

### 10.1 Middleware pipeline

Every API route uses a composed middleware pipeline. File:
`server/middleware/compose.ts`.

```typescript
type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

function compose(...middlewares: Middleware[]): Middleware;
```

**Middleware execution order for a standard route:**

1. `withRateLimit(config)` — Checks rate limit for the company+system pair.
   Config varies per route (auth routes are stricter).
2. `withAuth(options?)` — Verifies the System API Token. Extracts `userId`,
   `companyId`, `systemId` from the token. Accepts an optional
   `{ roles?: string[]; permissions?: string[] }` object. Superusers bypass all
   role/permission checks. If `roles` is provided, the user must have at least
   one of the listed roles. If `permissions` is provided, the user must have at
   least one of the listed granular permissions (or the `*` wildcard). Checks
   that the user is associated with the company and system.
3. `withPlanAccess(featureNames)` — Accepts an array of plan permission strings.
   Verifies the subscription is active and paid (within `currentPeriodEnd`).
   Verifies the plan includes at least one of the specified
   permissions/features.
4. `withEntityLimit(entityName)` — (Optional) Before entity creation, checks
   that the current count does not exceed the plan limit (plus voucher
   modifiers).

Auth routes (`/api/auth/*`) only use `withRateLimit` — they do not require
`withAuth`, `withPlanAccess`, or `withEntityLimit`.

### 10.2 Rate limiting

File: `server/utils/rate-limiter.ts`

- Sliding window algorithm, in-memory.
- Key: `{companyId}:{systemId}` for general routes; `{ip}` for auth routes.
- The global rate limit for a company+system pair is defined by the plan's
  `apiRateLimit` (plus voucher modifiers).
- This limit is distributed among users, tokens, and connected apps.
  Distribution strategy: each actor gets `floor(globalLimit / activeActorCount)`
  with a minimum of 1.
- Per-route overrides are passed as config to `withRateLimit`.

### 10.3 Usage tracking

File: `server/utils/usage-tracker.ts`

```typescript
async function trackUsage(params: {
  actorType: "user" | "token" | "connected_app";
  actorId: string;
  companyId: string;
  systemId: string;
  resource: string;
  value: number;
}): Promise<void>;
```

Increments (or upserts) a `usage_record` for the current period (`YYYY-MM`).
Called by route handlers after successful operations.

### 10.4 File upload/download routes

Uses `@hviana/surreal-fs` library exclusively. All file data **and** metadata
are stored within surreal-fs — there are no separate SQL queries or tables for
file tracking. A shared `SurrealFS` singleton lives in `server/utils/fs.ts`
(`getFS()`).

**Path pattern:**
`{companyId}/{systemSlug}/{userId}/{...category}/{crypto.randomUUID()}/{fileName}`

`category` is a `string[]` (multi-level, e.g. `["documents", "invoices"]`) that
is spread into the path. This allows directory-like browsing via `fs.readDir()`.

**Upload route** (`POST /api/files/upload`) — single route, dual mode:

FormData fields: `file`, `companyId`, `systemSlug`, `userId`, `category` (JSON
string array, e.g. `'["documents","invoices"]'`), optional `description`.

The route handles both authenticated and unauthenticated uploads in a single
endpoint. It determines the mode by attempting to verify the `Authorization`
header — if present and valid, the request is authenticated; otherwise it is
treated as an unauthenticated (public) upload.

**Authenticated mode** (user is logged in):

1. `withAuth` extracts `userId`, `companyId`, `systemId` from token.
2. Validate required FormData fields. Parse `category` from JSON.
3. Check file size against `files.maxUploadSizeBytes` core setting.
4. Generate `fileUuid = crypto.randomUUID()`.
5. Construct path array:
   `[companyId, systemSlug, userId, ...category, fileUuid, fileName]`.
6. Save via `fs.save({ path, content, metadata })` — metadata includes
   `companyId`, `systemSlug`, `userId`, `category`, `fileName`, `fileUuid`,
   `mimeType`, and optional `description`.
7. Return `{ uri, fileUuid, fileName, sizeBytes, mimeType }`.

**Unauthenticated mode** (no valid token — e.g. system logo upload by superuser
during initial setup, or public-facing forms):

1. Apply very strict rate limit: `files.publicUpload.rateLimit.perMinute` per IP
   (default `"3"`).
2. Validate required FormData fields. Parse `category` from JSON.
3. **Path whitelist:** The constructed path must match one of the patterns in
   `files.publicUpload.allowedPathPatterns` (a JSON array of glob-like patterns,
   e.g. `["*/*/logos/*"]`). Reject if no pattern matches.
4. **Size limit:** File size must not exceed `files.publicUpload.maxSizeBytes`
   (default `"2097152"` = 2 MB). This is intentionally much smaller than the
   authenticated limit.
5. **Extension whitelist:** Only extensions listed in
   `files.publicUpload.allowedExtensions` (default
   `'[".svg",".png",".jpg",".jpeg",".webp"]'`) are allowed.
6. Use `@hviana/surreal-fs` `control` callback to enforce path and size
   constraints at the storage layer:

   ```typescript
   await fs.save({
     path,
     content: bytes,
     metadata,
     control: (savePath, concurrencyMap) => {
       // Validate that savePath matches the allowed patterns
       // Check concurrencyMap to enforce per-path write limits
       // Return false to reject the save operation
       return isPathAllowed(savePath, allowedPatterns);
     },
   });
   ```

   The `control(path, concurrencyMap)` callback from `@hviana/surreal-fs` is
   invoked before the actual write. It receives the target path and a map of
   current concurrent operations. The callback returns `true` to allow the write
   or `false` to reject it. This provides a storage-level safety net that
   enforces path restrictions even if the application-level checks are bypassed.

7. Generate `fileUuid`, construct path, save, and return as in authenticated
   mode.

**Download route** (`GET /api/files/download?uri=...`):

1. Split the `uri` query parameter into a path array.
2. Read via `fs.read({ path })` — returns the file with its content stream and
   metadata.
3. Extract `fileName` and `mimeType` from `file.metadata` (falls back to the
   last path segment and `application/octet-stream`).
4. Stream the response with `Content-Type`, `Content-Disposition`, and
   `Content-Length` headers.

### 10.5 Public API routes

Routes under `/api/public/` require no authentication and no middleware
pipeline. They expose only non-sensitive, read-only data.

**`GET /api/public/system`** — Returns public system info.

- Query params: `slug` (system slug) OR `default=true` (resolve from
  `app.defaultSystem` setting).
- Response: `{ success: true, data: { name, slug, logoUri } }` or
  `{ success: true, data: null }` if not found.
- No rate limiting (static-like data). If abuse becomes a concern, add
  `withRateLimit` later.

**`POST /api/leads/public`** — Unauthenticated lead registration and update
verification.

- Requires `botToken` (bot protection challenge).
- Payload: `name`, `email`, `phone?`, `profile`, `companyIds`, `systemSlug`.
  Tags are **not accepted** — only authenticated users can manage tags.
- **New lead:** Creates the lead record and associates it with the specified
  companies and system. Returns `{ requiresVerification: false, id }`.
- **Existing lead (matched by email or phone):** Does not modify the lead
  directly. Instead, creates a `verification_request` (type `email_verify`) and
  publishes a `SEND_EMAIL` event with the verification template. Returns
  `{ requiresVerification: true }`. The lead data is updated only after the user
  clicks the verification link.
- **Cooldown:** Uses `auth.verification.cooldown.seconds` core setting to
  prevent repeated verification requests for the same lead. Returns 429 if the
  cooldown has not elapsed since the last request.
- **Expiry:** Uses `auth.verification.expiry.minutes` core setting for the
  verification token lifetime.
- System-specific routes (e.g. `/api/systems/grex-id/leads/public`) can delegate
  to this core route and add system-specific logic (e.g. face biometrics) on
  top.

### 10.6 Backend query directives

All query files in `server/db/queries/` follow these rules:

- **Creation queries:** Always check entity count against plan limits before
  inserting (use `withEntityLimit` or inline count check in the query).
- **Listing queries:** Always use cursor-based pagination, never `SKIP`. Accept
  a `limit` parameter from the frontend, capped at 200 on the backend.
- **Search queries:** Use SurrealDB full-text search indexes
  (`FULLTEXT ANALYZER`) where applicable.
- **Queries are never inlined in route handlers.** They are imported from the
  `queries/` folder.
- **Deduplication:** Entity creation routes that involve fields requiring
  uniqueness **must** call `checkDuplicates()` from
  `server/utils/entity-deduplicator.ts` before inserting. Do not write ad-hoc
  duplicate-check queries — use the entity deduplicator (Section 10.8).
- **Standardization:** All user-provided field values **must** be standardized
  via `standardizeField()` from `server/utils/field-standardizer.ts` before
  validation and storage. Do not write ad-hoc `trim()`, `toLowerCase()`, or
  `replace()` calls — use the field standardizer (Section 10.9).
- **Validation:** All field validations **must** use `validateField()` from
  `server/utils/field-validator.ts`. Do not write ad-hoc validation checks in
  route handlers — use the field validator (Section 10.10). Validation errors
  are returned as `{ code: "VALIDATION", errors: string[] }` where `errors`
  contains i18n keys from `validation.*`.
- **Single-call rule (transaction safety):** The backend uses a single shared
  SurrealDB connection. Concurrent API requests interleave on this connection,
  so **every query function must send all its statements in a single
  `db.query()` call**. Never issue multiple sequential `await db.query()` calls
  within the same function — batch them using SurrealQL multi-statement syntax
  (`LET`, semicolons). Never use `Promise.all` with multiple `db.query()` calls.
  Separate calls create implicit transactions that conflict under concurrency,
  producing `"Transaction conflict: Resource busy"` errors. Use `LET` variables
  to pass results between statements (e.g.
  `LET $prof = CREATE profile ...; CREATE user SET profile = $prof[0].id;`). Use
  `UPSERT ... WHERE` instead of read-then-write patterns. The final
  `SELECT ... FETCH` to resolve record links must also be part of the same
  batched query.

### 10.7 SurrealDB backend connection

File: `server/db/connection.ts`

```typescript
// Uses static credentials from Core for backend operations.
// Connects via HTTP (not WebSocket) for serverless compatibility.
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

### 10.8 Entity Deduplicator

File: `server/utils/entity-deduplicator.ts`

A Core resource that checks for existing records in SurrealDB before creation,
preventing duplicate entities. **This resource MUST be used for every entity
creation operation where one or more fields require uniqueness** (e.g. user
registration, company creation, system creation, voucher creation). Do not
implement ad-hoc duplicate checks in route handlers or query files — always
delegate to the entity deduplicator.

```typescript
export interface DeduplicationField {
  field: string; // Column name in the table (e.g. "email", "phone")
  value: unknown; // Value to check against
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  conflicts: {
    field: string;
    value: unknown;
    existingRecordId: string;
  }[];
}

/**
 * Checks whether any existing records in `entity` match any of the
 * provided field→value pairs. Each pair is checked independently —
 * a conflict on *any* field marks the result as a duplicate.
 *
 * Null/undefined values in the field list are silently skipped
 * (e.g. an optional phone number that was not provided).
 */
export async function checkDuplicates(
  entity: string,
  fields: DeduplicationField[],
): Promise<DeduplicationResult>;
```

**Usage example (user registration):**

```typescript
import { checkDuplicates } from "@/server/utils/entity-deduplicator";

const dup = await checkDuplicates("user", [
  { field: "email", value: email },
  { field: "phone", value: phone },
]);
if (dup.isDuplicate) {
  // Return 409 with dup.conflicts details
}
```

**Rules:**

- Always call `checkDuplicates` **before** the `CREATE` query.
- Pass every field that has a `UNIQUE` index or that must be logically unique.
- Optional fields with null/undefined values are skipped automatically.
- The function queries each field independently so it can report _which_ fields
  conflict, enabling precise error messages to the client.

### 10.9 Field Standardizer

File: `server/utils/field-standardizer.ts`

A Core resource that transforms and standardizes field values before validation
and storage. **This resource MUST be used for every field that accepts
user-provided data** where standardization is needed (e.g. email, phone, name).
Do not implement ad-hoc standardization in route handlers — always delegate to
the field standardizer.

```typescript
/**
 * Standardizes a field value based on the entity and field name.
 *
 * Resolution order:
 * 1. Entity+field specific standardizer (e.g. "user.email")
 * 2. Generic field standardizer (e.g. "email")
 * 3. Default: trim + sanitize angle brackets
 *
 * @param field  - The field name (e.g. "email", "phone")
 * @param value  - The raw value from the frontend
 * @param entity - Optional entity name (e.g. "user", "lead")
 * @returns The standardized value
 */
export function standardizeField(
  field: string,
  value: string,
  entity?: string,
): string;

/**
 * Registers a custom standardizer for a specific entity+field combination
 * or a generic field standardizer.
 */
export function registerStandardizer(
  field: string,
  fn: (value: string) => string,
  entity?: string,
): void;
```

**Built-in standardizers:**

| Field      | Transformation                                     |
| ---------- | -------------------------------------------------- |
| `email`    | Trim, lowercase, collapse whitespace               |
| `phone`    | Strip all non-digit characters                     |
| `name`     | Trim, collapse whitespace, remove `<>`             |
| `slug`     | Trim, lowercase, spaces to hyphens, strip non-slug |
| `document` | Strip all non-digit characters                     |
| (default)  | Trim, remove `<>`                                  |

**Usage example (user registration):**

```typescript
import { standardizeField } from "@/server/utils/field-standardizer";

const email = standardizeField("email", body.email, "user");
// " John@Example.COM " → "john@example.com"

const phone = standardizeField("phone", body.phone, "user");
// "+1 (555) 123-4567" → "15551234567"
```

**Rules:**

- Always call `standardizeField` **before** validation and storage.
- Pass the `entity` parameter when the field belongs to a known entity.
- Entity-specific standardizers override generic ones, allowing per-entity
  customization via `registerStandardizer`.

### 10.10 Field Validator

File: `server/utils/field-validator.ts`

A Core resource that validates field values and returns i18n error keys. **This
resource MUST be used for every field validation on API routes.** Do not
implement ad-hoc validation checks in route handlers — always delegate to the
field validator.

```typescript
/**
 * Validates a field value based on the entity and field name.
 *
 * Resolution order:
 * 1. Entity+field specific validator (e.g. "user.email") — overrides generic
 * 2. Generic field validator (e.g. "email")
 * 3. No validator found — returns empty array (valid)
 *
 * @param field  - The field name (e.g. "email", "phone", "password")
 * @param value  - The value to validate
 * @param entity - Optional entity name (e.g. "user", "lead"). If provided and
 *   a specific validator exists for the entity+field combination, it overrides
 *   the generic field validator.
 * @returns An empty array if valid, or an array of i18n error keys if invalid
 */
export function validateField(
  field: string,
  value: unknown,
  entity?: string,
): string[];

/**
 * Validates multiple fields at once. Returns a map of field name to error keys.
 * Only fields with errors are included in the result.
 */
export function validateFields(
  fields: { field: string; value: unknown }[],
  entity?: string,
): Record<string, string[]>;

/**
 * Registers a custom validator for a specific entity+field combination
 * or a generic field validator.
 */
export function registerValidator(
  field: string,
  fn: (value: unknown) => string[],
  entity?: string,
): void;
```

**Built-in validators:**

| Field          | Validation rules                           | Error i18n keys                             |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| `email`        | Required, regex format check               | `validation.email.required`, `.invalid`     |
| `phone`        | Optional; if provided, 10-15 digits        | `validation.phone.invalid`                  |
| `password`     | Required, minimum 8 characters             | `validation.password.required`, `.tooShort` |
| `name`         | Required, non-empty after trim             | `validation.name.required`                  |
| `slug`         | Required, lowercase alphanumeric + hyphens | `validation.slug.required`, `.invalid`      |
| `url`          | Optional; if provided, must be parseable   | `validation.url.invalid`                    |
| `currencyCode` | 3 uppercase letters                        | `validation.currencyCode.invalid`           |
| `cnpj`         | Required, 14 digits, valid check digits    | `validation.cnpj.required`, `.invalid`      |

**Validation i18n keys** live in `src/i18n/{locale}/validation.json` under the
`validation` domain (e.g. `t("validation.email.invalid", locale)`).

**Usage example (user registration):**

```typescript
import { validateField } from "@/server/utils/field-validator";

const emailErrors = validateField("email", email, "user");
const passwordErrors = validateField("password", password, "user");

const allErrors = [...emailErrors, ...passwordErrors];
if (allErrors.length > 0) {
  return NextResponse.json(
    { success: false, error: { code: "VALIDATION", errors: allErrors } },
    { status: 400 },
  );
}
```

**Rules:**

- Always call `validateField` **after** standardization and **before** storage.
- Pass the `entity` parameter when the field belongs to a known entity, so
  entity-specific overrides take effect.
- Route handlers return `{ code: "VALIDATION", errors: string[] }` where
  `errors` is the array of i18n keys. The frontend resolves them via `t()`.
- Entity-specific validators override generic ones, allowing per-entity
  customization via `registerValidator`.
- The `phone` validator treats empty/null/undefined as valid (optional field).
  Other validators that start with a required check explicitly state so.

---

## 11. Frontend Architecture

### 11.1 SurrealDB frontend connection

File: `client/db/connection.ts`

```typescript
// Connects via WebSocket using the SurrealDB user-scoped token.
// Used exclusively for LIVE SELECT queries.
export async function connectFrontendDb(userToken: string): Promise<Surreal>;
```

### 11.2 Client-side payment tokenization

File: `client/utils/payment/interface.ts`

```typescript
export interface IClientPaymentProvider {
  tokenize(
    cardData: CardInput,
    billingAddress: Address,
  ): Promise<TokenizationResult>;
}
```

File: `client/utils/payment/credit-card.ts` — implements
`IClientPaymentProvider` for credit card tokenization. The implementation
details depend on the payment gateway's client-side SDK.

### 11.3 React hooks

| Hook               | File                            | Purpose                                                                                                                                                                   |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useDebounce`      | `src/hooks/useDebounce.ts`      | Returns a debounced value with configurable delay.                                                                                                                        |
| `useAuth`          | `src/hooks/useAuth.ts`          | Provides `user`, `systemToken`, `surrealToken`, `login()`, `logout()`, `refresh()`.                                                                                       |
| `useLiveQuery`     | `src/hooks/useLiveQuery.ts`     | Wraps SurrealDB `LIVE SELECT`. Manages WebSocket connection and returns reactive data.                                                                                    |
| `useSystemContext` | `src/hooks/useSystemContext.ts` | Provides current `companyId`, `systemId`, `systemSlug`, `plan`, `roles`, plus `companies`, `systems` lists and `switchCompany()`, `switchSystem()` for context switching. |
| `useLocale`        | `src/hooks/useLocale.ts`        | Consumes `LocaleContext`; provides `locale`, `setLocale()`, `t()`, `supportedLocales`.                                                                                    |
| `usePublicSystem`  | `src/hooks/usePublicSystem.ts`  | Fetches public system info by slug (no auth). Used by homepage and auth pages for branding.                                                                               |

---

## 12. UI Component Architecture

### 12.0 Public Homepages

Each system has its own dedicated homepage component — a full `.tsx` page with
complete creative freedom over layout, content, and styling (within the project
visual standard). There is no shared generic template; every system designs its
own promotional page.

**Router:** `app/page.tsx`

The root page reads `?system=<slug>` and resolves the homepage:

1. `?system=<slug>` query parameter.
2. `app.defaultSystem` core setting (via `/api/public/system?default=true`).
3. If neither resolves or no matching component exists → core fallback.

It fetches the system's public info from `/api/public/system` and then looks up
the homepage component in the **homepage registry**
(`src/components/systems/registry.ts → getHomePage(slug)`). The matched
component is rendered inside `<Suspense>`.

If no system is resolved or no matching homepage component exists,
`app/page.tsx` renders the **core homepage** inline — a welcome message and a
"Get Started" button linking to `/login`.

**Homepage registry** (in `src/components/systems/registry.ts`):

```typescript
registerHomePage(
  "my-system",
  () => import("@/src/components/systems/my-system/HomePage"),
);
```

**System homepage components** live at:
`src/components/systems/[system-slug]/HomePage.tsx`

Each component is a standalone page with full control. It receives no props — it
can use `useLocale()` for i18n and link to `/login?system=<slug>` for the
sign-in CTA.

### 12.1 Spinner

File: `src/components/shared/Spinner.tsx`

Rendered using TailwindCSS `animate-spin` on a circular border element. Shown
whenever an async action is in progress (API calls, WASM execution, worker
tasks).

```
Props: { size?: "sm" | "md" | "lg" }
```

### 12.2 Sidebar

File: `src/components/shared/Sidebar.tsx`

- Starts hidden (mobile-first). A hamburger button toggles visibility.
- Clicking outside or clicking a menu item closes it.
- Contains `SidebarSearch` at the top and recursive `SidebarMenuItem`
  components.
- Menu items are loaded from the Core's menu configuration for the current
  system.
- Filtering: items with roles not matching the user's roles are excluded. Items
  hidden by the current plan are excluded.

File: `src/components/shared/SidebarMenuItem.tsx`

- Recursive component: renders children as expandable sub-items (unlimited
  depth).
- Click expands/collapses children; leaf items navigate to the mapped component.
- Search filtering: if a child matches the search term, parent stays visible.

File: `src/components/shared/SidebarSearch.tsx`

- Uses `useDebounce` to filter menu items as the user types.

### 12.3 Component mapping (Menu → Component)

Each `MenuItem.componentName` maps to a React component. A registry in
`src/components/systems/registry.ts`:

```typescript
const componentRegistry: Record<string, React.LazyComponent> = {
  // Core common items
  "users-list": lazy(() => import("@/components/shared/UsersPage")),
  "company-edit": lazy(() => import("@/components/shared/CompanyEditPage")),
  "billing": lazy(() => import("@/components/shared/BillingPage")),
  "usage": lazy(() => import("@/components/shared/UsagePage")),
  "connected-apps": lazy(() => import("@/components/shared/ConnectedAppsPage")),
  "tokens": lazy(() => import("@/components/shared/TokensPage")),
  // System-specific items are registered dynamically
};

export function registerComponent(
  name: string,
  loader: () => Promise<{ default: React.ComponentType }>,
): void;
export function getComponent(name: string): React.LazyComponent | null;
```

The `[...slug]/page.tsx` dynamic route resolves the `componentName` from the
current menu path and renders the corresponding component from the registry,
wrapped in `<Suspense>` with a `<Spinner>`.

### 12.4 Generic list system

File: `src/components/shared/GenericList.tsx`

```
Props: {
  entityName: string;                          // Used by CreateButton
  searchEnabled?: boolean;                     // Shows SearchField
  createEnabled?: boolean;                     // Shows CreateButton
  filters?: FilterConfig[];                    // If empty, no filter dropdown
  fetchFn: (params: CursorParams & { search?: string; filters?: FilterValues }) => Promise<PaginatedResult<T>>;
  renderItem?: (item: T, controls: ReactNode) => ReactNode;  // Custom item renderer
  fieldMap?: Record<string, FieldType>;        // For GenericListItem (default renderer)
  controlButtons?: ("edit" | "delete")[];      // Default: ["edit", "delete"]
  debounceMs?: number;                         // For SearchField, default 300
  formSubforms?: SubformConfig[];              // Subforms for create/edit modal
  createRoute?: string;                        // API route for creation
  editRoute?: (id: string) => string;          // API route for editing
  deleteRoute?: (id: string) => string;        // API route for deletion
  fetchOneRoute?: (id: string) => string;      // API route to fetch full entity for editing
}
```

**Behavior:**

- `SearchField` triggers search after debounce.
- `CreateButton` opens a `FormModal` with the configured subforms and
  `createRoute`.
- `EditButton` fetches the full entity via `fetchOneRoute`, then opens
  `FormModal` in edit mode.
- `DeleteButton` opens a confirmation modal; on confirm, calls `deleteRoute` and
  refreshes the list.
- Pagination is cursor-based, with "Load More" or "Previous/Next" navigation.
- Filters appear in `FilterDropdown`. Applied filters show as `FilterBadge`
  components with a remove action.

File: `src/components/shared/GenericListItem.tsx`

```
Props: {
  data: Record<string, unknown>;
  fieldMap: Record<string, FieldType>;
  controls: ReactNode;
}
```

Renders each field as a row: `"fieldName: formattedValue"`. Formatting is
determined by `FieldType` (dates formatted with locale, currency formatted,
etc.).

### 12.5 Filter system

File: `src/components/shared/FilterDropdown.tsx` — compact dropdown that reveals
configured filters.

File: `src/components/shared/DateRangeFilter.tsx`

```
Props: {
  maxRangeDays: number;       // Maximum allowed date range
  onChange: (start: Date, end: Date) => void;
}
```

File: `src/components/shared/FilterBadge.tsx`

```
Props: {
  label: string;
  onRemove: () => void;
}
```

**`TagSearch`**

File: `src/components/shared/TagSearch.tsx` — a tag filter component that wraps
`MultiBadgeField` in `mode: "search"`. It fetches tags from `/api/tags?search=`
and emits selected tag IDs for use as a list filter.

```
Props: {
  value: string[];                   // Currently selected tag IDs
  onChange: (tagIds: string[]) => void;
  label?: string;                    // Override label (default: i18n common.tags)
  debounceMs?: number;               // Default 300
}
```

Behavior:

- Wraps `MultiBadgeField` with `mode: "search"` and a `fetchFn` that calls
  `/api/tags?search=<query>`.
- Converts between the `MultiBadgeField` `BadgeValue[]` format (objects with
  `name`, `color`, and an extra `id` tracked internally) and the flat `string[]`
  of tag IDs that consumers (e.g. `GenericList` filter values) expect.
- Badges display the tag name with its color.
- Designed to be placed alongside `FilterDropdown` in list page toolbars, or
  inside filter panels.

### 12.5.1 Download data button

File: `src/components/shared/DownloadData.tsx`

A button component that exports data as an XLSX file. It accepts either a static
array of objects or an async function that fetches the data (e.g. an AJAX
request). When clicked, it generates the spreadsheet and triggers an automatic
browser download.

```
Props: {
  data: Record<string, unknown>[] | (() => Promise<Record<string, unknown>[]>);
  fileName?: string;           // Download file name without extension (default: "export")
  sheetName?: string;          // Worksheet name (default: "sheet1")
  label?: string;              // Button label i18n key (default: "common.download")
}
```

**Behavior:**

- If `data` is a function, it is called on click; a `Spinner` is shown inside
  the button while the data is being fetched.
- After data is resolved, it uses the `xlsx` library to convert the array of
  objects to an XLSX workbook, writes it as a compressed array buffer, and
  triggers a browser download via a temporary `<a>` element with
  `URL.createObjectURL`.
- If the data function throws or returns an empty array, no download occurs and
  the button returns to its idle state.
- The button follows the project visual standard (glassmorphism, hover effects).

### 12.6 Form modal system

File: `src/components/shared/FormModal.tsx`

```
Props: {
  title: string;                               // i18n key
  subforms: SubformConfig[];                   // Ordered list of subform components
  submitRoute: string;                         // API endpoint
  method: "POST" | "PUT";
  initialData?: Record<string, unknown>;       // For edit mode
  onSuccess: () => void;
  onClose: () => void;
}
```

**Behavior:**

- Renders a modal with each subform stacked vertically.
- Each subform manages its own validation and exposes `getData()` and
  `isValid()` methods via `useImperativeHandle`.
- The modal has a generic submit button (`GenericFormButton`) with a `Spinner`
  during submission.
- An `ErrorDisplay` component shows server-side errors.
- On submit: collects data from all subforms, merges into one payload, sends to
  `submitRoute`.

### 12.7 Subform components

All subforms follow this contract:

```typescript
interface SubformRef {
  getData(): Record<string, unknown>;
  isValid(): boolean;
}

interface SubformProps {
  initialData?: Record<string, unknown>;
  requiredFields?: string[]; // Override default required fields
  optionalFields?: string[]; // Override default optional fields
}
```

| Subform                        | Fields                                                                                       | Shared by                                |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ProfileSubform`               | name, avatarUri (FileUploadField), age                                                       | Users, Agents                            |
| `ContactSubform`               | email, phone                                                                                 | User registration/edit                   |
| `PasswordSubform`              | password, confirmPassword                                                                    | User registration/edit                   |
| `AddressSubform`               | street, number, complement, neighborhood, city, state, country, postalCode                   | Company, PaymentMethod                   |
| `CompanyIdentificationSubform` | name, document, documentType                                                                 | Company create/edit                      |
| `CreditCardSubform`            | number, cvv, expiryMonth, expiryYear, holderName, holderDocument + embedded `AddressSubform` | Payment method                           |
| `NameDescSubform`              | name, description (configurable required fields and character limits)                        | Tokens, Connected Apps, generic entities |

### 12.8 Reusable field components

#### 12.8.0 Field selection policy — prefer smart fields over plain inputs

**Every form field that accepts structured or relational data must use the
appropriate smart field component.** Plain `<input type="text">` is reserved for
truly free-form strings (e.g. a person's name, a description). The following
rules are mandatory:

| Data type                                                                    | Required component                                                     | Notes                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Multiple free-text values (permissions, tags, benefits)                      | `MultiBadgeField` `mode:"custom"`                                      | User types and presses Enter to add each value                            |
| Multiple values drawn from a known set (roles, system permissions, plan IDs) | `MultiBadgeField` `mode:"search"` with `fetchFn`                       | Only values from the backend are allowed; no arbitrary text               |
| Single or multiple related records (system, plan, role, company)             | `SearchableSelectField`                                                | Debounced API search; renders selected items as removable badges          |
| Static small set of options                                                  | `MultiBadgeField` `mode:"search"` with `staticOptions` or a `<select>` | Use `<select>` only when the option set is fixed and tiny (≤ 6 items)     |
| Key-value pairs (settings, entity limits)                                    | `DynamicKeyValueField`                                                 | Never use a plain `<textarea>` for JSON or comma-separated key-value data |
| File or image                                                                | `FileUploadField`                                                      | Never use a plain text URL input for user-uploaded assets                 |

**Never use a plain comma-separated `<input>` or `<textarea>` for:**

- Permissions arrays (use `MultiBadgeField mode:"custom"` or `mode:"search"`)
- Role assignments (use `MultiBadgeField mode:"search"` fetching from
  `/api/core/roles`)
- Benefit lists, plan permissions, voucher permissions (use
  `MultiBadgeField mode:"custom"`)
- Any field referencing a database entity by ID or name (use
  `SearchableSelectField`)

**`mode:"search"` vs `mode:"custom"` decision rule:**

- Use `mode:"search"` when the valid values are defined server-side (roles,
  system-specific permissions from existing role records, plan IDs, tag names).
  The user cannot invent new values outside the backend set.
- Use `mode:"custom"` when the valid values are open-ended strings that the user
  defines themselves (arbitrary permission strings on a new role, benefit labels
  on a new plan). The user types freely; the backend stores whatever strings are
  provided.

**`SearchableSelectField` vs `MultiBadgeField mode:"search"`:**

- Use `SearchableSelectField` for **record references** — when you need the
  record ID as the selected value (e.g. selecting a system, a plan, a company).
  The component emits `{ id, label }[]`.
- Use `MultiBadgeField mode:"search"` for **string values** drawn from a
  backend-defined set (e.g. role names, permission strings). The component emits
  strings or `{ name, color }` objects.

**ProfileMenu company/system selectors:** Use `SearchableSelectField` with
`multiple={false}` and `showAllOnEmpty` for both the company and system
selectors. The `fetchFn` filters from the locally available arrays. This
provides debounced search, badge display for the selected item, and a consistent
UX with the rest of the platform.

**`FileUploadField`**

```
Props: {
  fieldName: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
  companyId: string;             // Required by upload API (may be empty for unauthenticated uploads)
  systemSlug: string;            // System slug (NOT systemId) — matches the upload path pattern
  userId: string;                // Required by upload API (may be empty for unauthenticated uploads)
  category: string[];            // Multi-level path segments, e.g. ["logos"] or ["documents", "invoices"]
  previewEnabled?: boolean;      // Image preview with rounded borders (avatar)
  descriptionEnabled?: boolean;  // Optional text description
  onComplete: (uri: string) => void;
}
```

The component sends **all** required fields to `/api/files/upload` as FormData:
`file`, `companyId`, `systemSlug`, `userId`, `category` (JSON string array), and
optionally `description`. The upload API validates these fields on the server
side (see Section 10.4).

Behavior: shows upload progress bar, cancel button, delete button. Preview (if
enabled) shows a rounded image suitable for avatars. On completion, emits the
file URI.

**`SearchableSelectField`**

```
Props: {
  fetchFn: (search: string) => Promise<{ id: string; label: string }[]>;
  debounceMs?: number;
  multiple?: boolean;
  onChange: (selected: { id: string; label: string }[]) => void;
}
```

Behavior: debounced text input triggers `fetchFn`. Results shown in dropdown.
Selected items appear as removable badges.

**`DynamicKeyValueField`**

```
Props: {
  fields: { key: string; value: string; description: string }[];
  onChange: (fields: { key: string; value: string; description: string }[]) => void;
}
```

Behavior: add/remove key-value pairs with descriptions. Used by core settings
editor.

**`MultiBadgeField`**

```
Props: {
  name: string;                    // Field label
  mode: "custom" | "search";      // "custom" allows free text entry; "search" only allows selecting from results
  value: (string | { name: string; color?: string })[];  // Current values
  onChange: (value: (string | { name: string; color?: string })[]) => void;
  fetchFn?: (search: string) => Promise<(string | { name: string; color?: string })[]>;  // AJAX search (with debounce + spinner)
  staticOptions?: (string | { name: string; color?: string })[];  // Static options to search/filter locally
  formatHint?: string;            // Optional hint explaining expected format (e.g. "e.g. read:users, write:billing")
  debounceMs?: number;            // Default 300
}
```

Behavior:

- An input field (text or search) sits at the top. Below it, badges represent
  the currently entered values grouped in a flex-wrap container.
- **`mode: "custom"`**: the user types freely and presses Enter to add a value
  as a badge. If `fetchFn` or `staticOptions` are provided, a suggestion
  dropdown appears as the user types, but the user can still enter values not in
  the list.
- **`mode: "search"`**: the user can only select values from `fetchFn` results
  or `staticOptions`. Free text entry is not allowed.
- When `fetchFn` is provided, search is debounced and a spinner shows while
  loading. When `staticOptions` is provided, filtering is done locally.
- Each badge displays an "x" button to remove it.
- If items are strings, badges show the string text.
- If items are objects, badges show the `name` value. If the object has a
  `color` attribute (hex string), the badge background is rendered in that
  color.
- Already-selected values are excluded from the suggestion dropdown.

Used by: Roles (permissions), Plans (permissions, benefits), Vouchers
(permissions), Menus (requiredRoles, hiddenInPlanIds), and any other field that
previously used comma-separated textareas.

### 12.9 ProfileMenu

File: `src/components/shared/ProfileMenu.tsx`

The ProfileMenu is rendered in the `(app)` layout top bar. It contains:

1. **User avatar / name** — clickable to open the dropdown.
2. **Company selector** — lists all companies the user belongs to. The active
   company is highlighted. Selecting a different company updates
   `useSystemContext` and resets the system selector to the first system of the
   newly selected company.
3. **System selector** — lists all systems the selected company is subscribed to
   (only active subscriptions). The active system is highlighted. Selecting a
   different system updates `useSystemContext`.
4. **Profile link** — navigates to the user's profile settings.
5. **Logout button** — clears tokens and redirects to `/login`.

When company or system changes, the sidebar menus reload for the new system
context, and all context-dependent data (usage, billing) refreshes.

### 12.10 Every page receives the system context

All pages within the `(app)` route group receive the current system context via
`useSystemContext()`. This provides the company ID, system slug, plan, and
roles, which are used to load the correct logo, translations, menus, and
system-specific components.

The `(app)` layout is responsible for:

1. **Onboarding guard:** On mount, if the user has no companies, redirect to
   `/onboarding/company`. If the user has companies but no active system
   subscriptions, redirect to `/onboarding/system`.
2. **Default context:** When the user has completed onboarding, automatically
   select the first company and the first system of that company as the active
   context.
3. **Context persistence:** Store the selected `companyId` and `systemId` in
   cookies (`core_company` and `core_system`) so the selection survives page
   reloads. On mount, restore from cookies if valid; otherwise fall back to the
   first company/system.

### 12.11 Core Admin Panel components

The `(core)` route group is the superuser-only admin panel. Its layout renders a
sidebar with hardcoded core menus (Systems, Roles, Plans, Vouchers, Menus,
Terms, Settings). **All sidebar labels must use i18n keys** (e.g.
`t("core.nav.systems")`), never hardcoded English strings. The header text must
also use an i18n key (`t("core.layout.superuserPanel")`).

**Core i18n keys** live in `src/i18n/{locale}/core.json`. The JSON key format
omits the `core.` domain prefix (the `t()` function strips it automatically).
For example, `t("core.systems.title")` resolves to key `"systems.title"` in
`core.json`.

Every label, hint, placeholder label, button text, and status badge in core
pages must have a corresponding i18n key. The following key groups are required:

- `nav.*` — sidebar menu labels (e.g. `nav.systems`, `nav.roles`, `nav.terms`,
  `nav.dataDeletion`)
- `layout.*` — layout chrome (e.g. `layout.superuserPanel`)
- `systems.*` — system CRUD (title, create, edit, name, slug, logo, empty)
- `roles.*` — role CRUD (title, create, edit, name, system, selectSystem,
  permissions, permissionsHint, builtIn, isBuiltIn, empty)
- `plans.*` — plan CRUD (title, create, edit, name, description, system,
  selectSystem, price, cents, currency, recurrenceDays, benefits, benefitsHint,
  permissions, entityLimits, entityLimitsHint, apiRateLimit, storageLimitBytes,
  storage, active, inactive, isActive, days, empty)
- `vouchers.*` — voucher CRUD (title, create, edit, code, priceModifier, cents,
  priceModifierHint, expiresAt, permissions, entityLimitModifiers,
  entityLimitModifiersHint, apiRateLimitModifier, storageLimitModifier, empty,
  expired, expires, apiRate, storage)
- `menus.*` — menu tree editor (title, selectSystem, label, emoji,
  componentName, sortOrder, requiredRoles, hiddenInPlanIds, edit, delete,
  addChild, addRoot, incompleteConfig, empty)
- `settings.*` — settings editor (title, key, value, description, save,
  missingTitle, addMissing, empty, add, saved, descriptionPlaceholder)
- `terms.*` — terms management (title, selectSystem, generic, genericHint,
  content, contentHint, save, saved, empty, noTerms, hasTerms, usingGeneric,
  editTerms, viewPublic)
- `dataDeletion.*` — data deletion page (title, selectCompany, selectSystem,
  deleteButton, warning, awareness, passwordLabel, passwordPlaceholder,
  confirmDelete, success, error.passwordInvalid, error.notFound)

All keys must have translations in both `en` and `pt-BR`.

**Core form conventions:**

- All core entity forms (SystemForm, RoleForm, PlanForm, VoucherForm) use
  `forwardRef` + `useImperativeHandle` to expose `getData()` and `isValid()`.
- **SystemForm**: name, slug, `FileUploadField` with `previewEnabled` for the
  system logo, and a `termsOfService` textarea for system-specific LGPD terms
  (HTML content). The `FileUploadField` receives `category={["logos"]}` and
  `systemSlug` from the form state. For core admin uploads where the user
  context is not yet available, `companyId`, `userId`, and `systemSlug` may be
  empty strings — the upload route handles this in unauthenticated mode with
  strict validation.
- **RoleForm**: name, systemId (select), isBuiltIn (checkbox), and
  `MultiBadgeField` for permissions (`mode: "custom"`,
  `formatHint: "e.g. read:users, write:billing"`).
- **PlanForm**: name, description, systemId, price, currency, recurrenceDays,
  apiRateLimit, storageLimitBytes, isActive. Uses `MultiBadgeField` for
  permissions (`mode: "custom"`), `MultiBadgeField` for benefits
  (`mode: "custom"`), and `DynamicKeyValueField` for entityLimits.
- **VoucherForm**: code, priceModifier, apiRateLimitModifier,
  storageLimitModifier, expiresAt. Uses `MultiBadgeField` for permissions
  (`mode: "custom"`), and `DynamicKeyValueField` for entityLimitModifiers.

**MenuTreeEditor** (`src/components/core/MenuTreeEditor.tsx`):

The menu editor is **not** a standard list page. It is a dedicated tree editor
component with the following behavior:

1. **System selector**: A dropdown at the top selects the system. Only menus for
   the selected system are displayed. Changing the system reloads the tree.
2. **Tree display**: Menus are rendered as a hierarchical tree with indentation:
   ```
   📈 Usage
   📁 Reports
   ├── 📈 Sales Report
   ├── 📉 Analytics
   │   └── 📊 Deep Dive
   ```
3. **Inline add ("+" buttons)**: "+" emoji buttons are positioned in the tree at
   each level — one at root level and one inside each node (to add a child).
   Clicking "+" opens an inline text input **in place of the "+" itself** (with
   a close/cancel button) asking only for the menu label. On Enter/submit, the
   menu item is created with just the label (and the parent + system context).
   No modal is opened for creation.
4. **Incomplete configuration badge**: If a menu item is missing required
   configuration (e.g. `componentName` is empty), a "⚠" badge is displayed next
   to it. Structural menus (those that only group submenus) are expected to have
   no `componentName` and are not flagged.
5. **Edit button**: Each menu item has a "✏️" emoji button that opens a modal to
   edit all properties **except hierarchy** (label, emoji, componentName,
   sortOrder, requiredRoles via `MultiBadgeField`, hiddenInPlanIds via
   `MultiBadgeField`). The parent-child relationship is managed exclusively via
   drag-and-drop.
6. **Delete button**: Each menu item has a "🗑️" emoji button with confirmation.
7. **Drag-and-drop**: Menu items can be dragged to reorder within the same level
   (changes `sortOrder`) or moved to a different parent (changes `parentId`).
   The tree updates optimistically and persists via API.
8. **No search/create button**: Unlike standard list pages, the menu editor does
   not have a search bar or a top-level create button. All additions happen via
   the inline "+" buttons in the tree.

### 12.12 Subsystem Panel (Authenticated User Panel)

The `(app)` route group is the **subsystem panel** — the authenticated user's
workspace scoped to a specific company + system pair. It is **not** the core
admin panel. All UI elements must reflect the active system context (logo, name,
menus) and never fall back to "Core" branding.

#### 12.12.1 System branding in sidebar

The `Sidebar` component receives `systemLogo` and `systemName` from the active
system in `useSystemContext()`. The `(app)` layout must pass the system's
`logoUri` (resolved via the file download endpoint) and `name` to the sidebar.
If the system has a logo, the sidebar header shows the system logo + name. The
sidebar must **never** display "Core" as the system name — that label is
reserved for the `(core)` layout only. If no system is selected (edge case
during loading), show a `Spinner` instead of a fallback name.

The `(app)` layout loads menus from the API for the active system
(`GET /api/core/menus?systemId=...`), filtered by the user's roles and plan.
**Custom system menus are always followed by the shared default menus.** The
layout fetches the system's `menu_item` records from the backend (custom menus)
and then appends hardcoded default menus (usage, billing, users, company-edit,
connected-apps, tokens) after them. The default menus' `sortOrder` values are
offset by `max(customSortOrder) + 1` so they always appear below the
system-specific items. If the API returns no custom menus, only the defaults are
shown. This ensures that creating custom menus for a system never hides the
shared menus — they always remain visible at the bottom of the sidebar.

**Initial page rule:** The panel's initial page is determined dynamically by the
**first menu item with a non-empty `componentName`** found via depth-first
traversal of the full menu tree (custom menus first, then shared defaults,
ordered by `sortOrder`). The `(app)` layout uses `findFirstComponent(tree)` to
resolve this after loading menus, and navigates to `/<componentName>`. This
happens in three places: (1) initial layout load (after login), (2) company
switch, (3) system switch. The login page redirects to `/entry` — a lightweight
spinner-only page inside the `(app)` route group (`app/(app)/entry/page.tsx`)
that never renders real content. This avoids loading any actual page component
before the layout resolves the target route. If a system defines custom menus,
the first custom menu's component becomes the landing page; if no custom menus
exist, the first default menu (typically "usage") is used.

#### 12.12.2 Plan cards (onboarding + billing)

Plan cards appear in two places: the onboarding system page
(`/onboarding/system`) and the billing page. Both must use the same rich card
design — a visually stunning glassmorphism card matching the project's visual
standard.

**Plan card design:**

```
┌─────────────────────────────────────────────┐
│  [Plan Name]                    [Price/mo]  │
│  [Description]                              │
│                                             │
│  ── Benefits ──────────────────────────────  │
│  ✓ Benefit 1 (translated)                   │
│  ✓ Benefit 2 (translated)                   │
│  ✓ Benefit 3 (translated)                   │
│                                             │
│  ── Limits ────────────────────────────────  │
│  📊 API Rate: 1,000 req/min                 │
│  💾 Storage: 1 GB                           │
│  👥 Users: 50                               │
│  📁 Projects: 10                            │
│                                             │
│  [Subscribe / Current Plan badge]           │
└─────────────────────────────────────────────┘
```

**Visual details:**

- Card:
  `backdrop-blur-md bg-white/5 border border-dashed
  border-[var(--color-dark-gray)] rounded-2xl p-6`.
  Selected/current plan:
  `border-[var(--color-primary-green)] shadow-lg
  shadow-[var(--color-light-green)]/20 -translate-y-1`.
- Plan name: `text-xl font-bold text-white`. Resolved via `t()`.
- Price: `text-2xl font-bold
  text-[var(--color-primary-green)]`. Free plans
  show a translated "Free" badge
  (`bg-[var(--color-primary-green)]/20
  text-[var(--color-primary-green)] px-3 py-1 rounded-full`).
  Paid plans show formatted currency + recurrence (e.g. "$9.99 / 30 days").
- Description: `text-sm text-[var(--color-light-text)]`. Resolved via `t()`.
- Benefits section: header with gradient text, each benefit on its own line with
  a green checkmark (`✓`). Benefits are i18n keys resolved via `t()`.
- Limits section: header with gradient text, each limit with an emoji and
  formatted value. Entity limits from `plan.entityLimits` are iterated — keys
  are displayed as translated labels (e.g. `t("billing.limits." + key)`), values
  are formatted numbers. `apiRateLimit` and `storageLimitBytes` are also shown
  with human-readable formatting (e.g. "1,000 req/min", "1 GB").
- Subscribe button: gradient button at the bottom. For the current plan, a
  "Current Plan" badge replaces the button.

#### 12.12.3 Users page (admin CRUD)

File: `src/components/shared/UsersPage.tsx`

The users page lists all users associated with the current company + system. It
must support full CRUD operations for users with the `admin` role in the current
system context.

**User invite flow:**

When an admin creates a user (`POST /api/users`), the backend first checks
whether a user with that email already exists:

- **New user:** Creates the user record with profile, hashes the password, and
  creates `company_user` and `user_company_system` associations with the
  specified roles.
- **Existing user (email match):** Does not create a new account. Instead,
  creates or updates the `company_user` and `user_company_system` associations
  for the target company+system, setting the specified roles. Returns
  `{ success: true, invited: true }`. The frontend shows a success message
  (`common.users.inviteExisting`).

**Roles are per-company+system pair.** The `user_company_system` table stores
the roles for each user in each specific company+system context. The same user
can have different roles in different systems. When a user is removed
(`DELETE /api/users`), only the `user_company_system` association is deleted —
the user record and other system associations remain intact.

**Features:**

- **Search:** Debounced search field (already present).
- **Create / Invite user:** Opens a modal with name, email, phone, password
  fields, and a `MultiBadgeField` (mode: `"search"`) for role assignment
  fetching from `/api/core/roles?systemId=...`. A hint below the form explains
  the invite flow. The `password` field is only used for new accounts — it is
  silently ignored when inviting an existing user.
- **Edit user:** Opens a modal in edit mode. Editable fields: name (profile),
  phone, roles (`MultiBadgeField` mode: `"search"`). Email is read-only after
  creation. Calls `PUT /api/users`.
- **Delete user:** A delete button with confirmation. Calls `DELETE /api/users`
  which removes the `user_company_system` association (does NOT delete the user
  record — the user may belong to other companies/systems).
- **Role badges:** Each user row displays their context roles (from
  `user_company_system`) as colored badges.
- **Visibility:** Create/edit/delete buttons are only visible to users with the
  `admin` role in the current system (check `useSystemContext().roles`).

#### 12.12.4 Tokens page (CRUD)

File: `src/components/shared/TokensPage.tsx`

The tokens page lists API tokens for the current user + company + system. It
must support create and delete operations.

**Features:**

- **Create token:** Opens a modal with name, description fields, a
  `MultiBadgeField` for permissions (`mode: "search"`, fetches unique
  permissions from all roles for the current system via
  `/api/core/roles?systemId=...`), optional `monthlySpendLimit` input, and
  optional `expiresAt` date input. On success, a modal displays the raw token
  value **once** with a copy button and a warning that it cannot be shown again.
- **Delete token:** A `DeleteButton` on each row with confirmation. Calls
  `DELETE /api/tokens`.
- **Token list:** Each token card shows name, description, permissions as
  badges, expiry date, and creation date.

#### 12.12.5 Connected apps page (CRUD)

File: `src/components/shared/ConnectedAppsPage.tsx`

The connected apps page lists apps connected to the current company + system. It
must support create, edit, and delete operations.

**Features:**

- **Create connected app:** A `CreateButton` opens a `FormModal` with
  `NameDescSubform` (name only, description optional), `MultiBadgeField` for
  permissions (`mode: "custom"`), and optional `monthlySpendLimit` input. Calls
  `POST /api/connected-apps`.
- **Edit connected app:** An `EditButton` on each row opens a `FormModal` in
  edit mode. Editable fields: name, permissions, spend limit. Calls
  `PUT /api/connected-apps`.
- **Delete connected app:** A `DeleteButton` with confirmation. Calls
  `DELETE /api/connected-apps`.
- **App list:** Each card shows name, permission count/badges, spend limit (if
  set), and creation date.

#### 12.12.6 Billing page (full functionality)

File: `src/components/shared/BillingPage.tsx`

The billing page provides complete subscription and payment management for the
current company + system. It is organized into sections:

**1. Current Plan section:**

- Displays the active subscription's plan card (Section 12.12.2 design) with a
  "Current Plan" badge.
- Shows next billing date (`currentPeriodEnd`).
- **Cancel button:** Opens a confirmation modal. On confirm, calls
  `POST /api/billing` with `action: "cancel"`. Updates subscription status to
  `"cancelled"`.
- If no active subscription exists, shows a message prompting the user to
  subscribe.

**2. Available Plans section:**

- Lists all active plans for the current system using the rich plan card design
  (Section 12.12.2).
- Each non-current plan has a **Subscribe** button. For paid plans, clicking
  Subscribe checks if a payment method exists — if not, opens the payment method
  modal first. Then calls `POST /api/billing` with `action: "subscribe"`.
- Plan change: if the user already has an active subscription and subscribes to
  a different plan, the backend cancels the old subscription and creates a new
  one in the same batched query.

**3. Payment Methods section:**

- Lists all payment methods for the current company. Each card shows card mask,
  holder name, "Default" badge if applicable.
- **Add Payment Method:** A `CreateButton` opens a `FormModal` with
  `CreditCardSubform` (which includes embedded `AddressSubform`). Calls
  `POST /api/billing` with `action: "add_payment_method"`.
- **Set Default:** Button on each non-default card. Calls `POST /api/billing`
  with `action: "set_default_payment_method"`.
- **Remove:** `DeleteButton` with confirmation. Calls `POST /api/billing` with
  `action: "remove_payment_method"`.

**4. Credits section:**

- Shows current credit balance for the company + system.
- **Purchase Credits:** A form with amount input and payment method selector.
  Calls `POST /api/billing` with `action: "purchase_credits"`.
- **Credit History:** Recent credit purchases list with status badges
  (pending/completed/failed).

**5. Voucher section:**

- Input field for voucher code with an "Apply" button.
- On submit, calls `POST /api/billing` with `action: "apply_voucher"`. The
  backend validates the voucher (exists, not expired, applicable to the
  company), adds the voucher ID to the subscription's `voucherIds`, and applies
  the modifiers.
- **Feedback appears inline, directly below the voucher input** — not at the top
  of the page. Success message (`billing.voucher.success`) in green; error
  message in red. Each applies per-section state (not global
  `setError`/`setSuccess`).
- After a successful apply, the input is cleared and the subscription reloads.
- The section also displays the list of currently applied (non-expired) vouchers
  as badges, each showing the code and the price effect (e.g. `−$5.00` or
  `+$2.00`).

**Voucher pricing: effective plan price**

A voucher's `priceModifier` (positive = discount, negative = surcharge, in
cents) adjusts the plan's displayed price throughout the billing pipeline:

- The `GET /api/billing` response returns subscriptions with `voucherIds`
  **FETCHed** (full voucher objects, not just IDs), so the frontend receives
  each voucher's `priceModifier` and `expiresAt`.
- The **effective price** = `plan.price − Σ(activeVoucher.priceModifier)` where
  active = not expired. If the result would be negative, it is clamped to 0.
- Wherever a plan price is displayed (Current Plan section, Available Plans
  cards), if active vouchers are applied, the original price is shown with
  strikethrough and the effective price is shown prominently next to it.
- This effective price is purely cosmetic on the frontend. The actual charge
  calculation occurs server-side in the recurring billing job and credit
  purchase handler, which must also apply voucher modifiers when computing the
  charge amount.

#### 12.12.7 Usage page (full functionality)

File: `src/components/shared/UsagePage.tsx`

The usage page displays resource consumption for the current company + system.
It fetches data from `GET /api/usage`. The page is organized into two sections:

**1. Storage section:**

- A horizontal bar chart (`react-chartjs-2` `Bar` component) showing used
  storage vs. available storage (plan limit + voucher modifiers).
- Storage usage is calculated on the backend using `@hviana/surreal-fs`
  `fs.readDir()` to sum file sizes under the `{companyId}/{systemSlug}/` path.
  The backend caches this value and recalculates periodically or on file
  upload/delete.
- Values displayed in human-readable format (e.g. "245 MB / 1 GB").
- The bar uses gradient fill
  (`from-[var(--color-primary-green)] to-[var(--color-secondary-blue)]`).

**2. Credit Expenses section:**

- A **column chart** (`react-chartjs-2` `Bar` component) showing credit expenses
  per resource over time.
- Each column represents a **resource key** (translated via `t()`). The column
  value is the sum of daily `credit_expense` records for that resource key over
  the selected period.
- **Date range filter** (`DateRangeFilter` component) with a **maximum interval
  of 31 days**. Default range: last 31 days.
- The chart X-axis shows the translated resource key labels. The Y-axis shows
  monetary values in the subscription's currency.
- Each resource key gets a distinct color (auto-assigned from a palette).
- Below the chart, a summary table lists each resource with its total expense
  for the period.
- **No "API Calls" metric** — the usage page does not track or display API call
  counts. Only storage and credit expenses are shown.

**Backend credit expense tracking:**

File: `server/utils/credit-tracker.ts`

```typescript
/**
 * Increments the credit expense for a given resource key on the current day.
 * Uses UPSERT to atomically create or increment the daily container.
 *
 * @param resourceKey - i18n key identifying the resource (e.g.
 *   "billing.credits.resource.faceDetection")
 * @param amount - Monetary value in smallest currency unit (cents)
 * @param companyId - Company record ID
 * @param systemId - System record ID
 */
export async function trackCreditExpense(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
}): Promise<void>;
```

The function uses the current date (`YYYY-MM-DD`) as the daily container key. It
issues a single
`UPSERT credit_expense SET amount += $amount WHERE
companyId = $companyId AND systemId = $systemId AND resourceKey = $resourceKey
AND day = $day`
query.

System-specific backend operations that consume credits call
`trackCreditExpense()` after the operation succeeds, passing the appropriate
resource key and cost. The resource keys are defined per system in the i18n
files under `billing.credits.resource.*`.

**Usage API route** (`GET /api/usage`):

Query params: `companyId`, `systemId`, `startDate` (YYYY-MM-DD), `endDate`
(YYYY-MM-DD).

Response:

```typescript
{
  success: true,
  data: {
    storage: {
      usedBytes: number;
      limitBytes: number; // From plan + voucher modifiers
    };
    creditExpenses: {
      resourceKey: string;
      totalAmount: number;
    }[];
  }
}
```

---

## 13. Event Queue System

### 13.1 Architecture overview

Two database tables: `queue_event` (the published fact) and `delivery` (one
record per handler per event). Workers pull from `delivery`, never from
`queue_event` directly.

### 13.2 Publishing

File: `server/event-queue/publisher.ts`

```typescript
async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date, // Defaults to now() for immediate events
): Promise<string>; // Returns event ID
```

Steps:

1. Insert into `queue_event` with `availableAt = availableAt ?? new Date()`.
2. Look up handlers for this event name in the registry.
3. For each handler, insert a `delivery` record with `status = "pending"`,
   `availableAt` copied from the event, `maxAttempts` from handler config.

### 13.3 Handler registry

File: `server/event-queue/registry.ts`

```typescript
const handlerRegistry: Record<string, string[]> = {
  "SEND_EMAIL": ["send_email"],
  "SEND_SMS": ["send_sms"],
  "PAYMENT_DUE": ["process_payment"],
  // Add more as systems grow
};

export function getHandlersForEvent(eventName: string): string[];
```

Entities that need to send communication publish `SEND_EMAIL` or `SEND_SMS` with
the template name, recipients, locale, and template data in the payload.

### 13.4 Worker loop

File: `server/event-queue/worker.ts`

Each worker is parameterized by a `WorkerConfig`. The worker loop:

```
LOOP forever:
  freeSlots = maxConcurrency - activeCount
  IF freeSlots <= 0:
    WAIT a short interval
    CONTINUE

  claimBatch = MIN(freeSlots, batchSize)

  // Transactional claim query:
  SELECT * FROM delivery
    WHERE handler = $handler
      AND status = "pending"
      AND availableAt <= time::now()
      AND (leaseUntil IS NONE OR leaseUntil <= time::now())
    ORDER BY availableAt ASC
    LIMIT $claimBatch

  // For each selected delivery, atomically update:
  UPDATE delivery SET
    status = "processing",
    leaseUntil = time::now() + $leaseDuration,
    workerId = $workerId,
    attempts = attempts + 1,
    startedAt = time::now()
  WHERE id = $deliveryId AND status = "pending"

  IF no deliveries claimed:
    WAIT idleDelay
    CONTINUE

  FOR EACH claimed delivery (in parallel, respecting maxConcurrency):
    TRY:
      event = FETCH queue_event WHERE id = delivery.eventId
      EXECUTE handler logic with event.payload
      UPDATE delivery SET
        status = "done",
        leaseUntil = NONE,
        finishedAt = time::now(),
        lastError = NONE
    CATCH error:
      IF delivery.attempts >= delivery.maxAttempts:
        UPDATE delivery SET
          status = "dead",
          leaseUntil = NONE,
          lastError = error.message,
          finishedAt = time::now()
      ELSE:
        backoff = retryBackoffBaseMs * 2^(delivery.attempts - 1)
        UPDATE delivery SET
          status = "pending",
          leaseUntil = NONE,
          availableAt = time::now() + backoff,
          lastError = error.message
```

### 13.5 Idempotency

Every handler implementation must be idempotent. This means:

- Check if the action was already performed before executing (e.g., check if
  welcome email was already sent for this user).
- Use the `delivery.id` or `event.id` as an idempotency key when interacting
  with external services.

### 13.6 Lease recovery

If a worker crashes, its claimed deliveries remain in `processing` status. Other
workers can pick them up after `leaseUntil` expires because the claim query
includes `OR leaseUntil <= time::now()`.

---

## 14. Communication System

There is no communication provider abstraction. All communication channels
(email, SMS, etc.) are implemented directly as **event handlers**. Entities that
need to send communication simply `publish()` an event with the required
parameters — the handler resolves templates, reads Core settings (senders,
provider config), and calls the external service.

### 14.1 Templates

Templates live in `server/utils/communication/templates/` and return a
`TemplateResult` (body + optional title). They use `t()` for i18n.

File: `server/utils/communication/templates/verification.ts`

```typescript
import { t } from "@/src/i18n";
import type { TemplateResult } from "@/src/contracts/communication";

export function verificationTemplate(
  locale: string,
  data: { name: string; verificationLink: string },
): TemplateResult {
  return {
    title: t("templates.verification.subject", locale, { name: data.name }),
    body: `<p>${
      t("templates.verification.greeting", locale, { name: data.name })
    }</p>
          <p>${t("templates.verification.body", locale)}</p>
          <a href="${data.verificationLink}">${
      t("templates.verification.action", locale)
    }</a>`,
  };
}
```

File: `server/utils/communication/templates/password-reset.ts` — same pattern
with `passwordReset` keys, returning `TemplateResult` with `title` and `body`.

Both templates have translations in `en` and `pt-BR` under
`src/i18n/{locale}/templates.json`.

### 14.2 Generic channel handlers

There are two generic channel handlers — one per delivery channel. They are the
**only** handlers that talk to external communication services.

**`send_email`** (`server/event-queue/handlers/send-email.ts`):

Handles `SEND_EMAIL` events. Expected payload:

```typescript
{
  recipients: string[];       // Email addresses
  template: string;           // Template name (e.g. "verification", "password-reset")
  templateData: Record<string, string>;  // Data passed to the template function
  locale?: string;            // Explicit locale (optional)
  systemSlug?: string;        // For locale resolution fallback
  senders?: string[];         // Override default senders (optional)
}
```

The handler:

1. Resolves locale: `payload.locale` (caller should pass the user's
   `profile.locale` when available) → system default (via `systemSlug`) →
   `"en"`.
2. Resolves senders: `payload.senders` → Core setting
   `communication.email.senders`.
3. Looks up the template function by name from
   `server/utils/communication/templates/`.
4. Renders the template with locale and `templateData`.
5. Calls the external email API (configured via Core setting
   `communication.email.provider`).

**`send_sms`** (`server/event-queue/handlers/send-sms.ts`):

Handles `SEND_SMS` events. Same payload shape as `send_email` (with phone
numbers as `recipients`). Uses Core setting `communication.sms.provider`.

### 14.3 Publishing communication events

Entities that need to send communication simply publish the appropriate channel
event. For example, the registration route publishes:

```typescript
await publish("SEND_EMAIL", {
  recipients: [email],
  template: "verification",
  templateData: { name, verificationLink },
  systemSlug,
});
```

Route handlers that need to send communication publish `SEND_EMAIL` or
`SEND_SMS` directly with the template and data. No intermediate business event
handlers are needed — the route performs its business logic and publishes the
channel event in one step.

---

## 15. Jobs

### 15.1 Job starter

File: `server/jobs/index.ts` — imports and starts all jobs.

### 15.2 Event queue startup

File: `server/jobs/start-event-queue.ts` — creates a worker instance for each
registered handler name with its respective `WorkerConfig`.

### 15.3 Recurring billing

File: `server/jobs/recurring-billing.ts`

Runs periodically (e.g. every hour). Logic:

1. Query all subscriptions where `status = "active"` and
   `currentPeriodEnd <= now()`.
2. For each due subscription: a. Publish a `PAYMENT_DUE` event with the
   subscription details. b. The `process_payment` handler processes the payment
   via the server-side payment provider. c. On success: update
   `currentPeriodStart` and `currentPeriodEnd` to the next cycle, reset
   `remainingPlanCredits` to `plan.planCredits` (fresh credits for the new
   period), and reset `creditAlertSent` to `false` (re-enabling the
   insufficient-credit email alert for the new cycle). d. On failure: set
   subscription `status = "past_due"`.

---

## 16. Connected Apps & OAuth Flow

### 16.1 External app connection flow (platform OAuth)

The platform exposes an OAuth-like authorization flow that lets third-party
applications request scoped access to a user's data. This is **not** social
login — it is the platform acting as an OAuth **server** for external consumers.

**Authorization URL format:**

```
/oauth/authorize
  ?client_name=MyApp          # display name of the requesting app
  &permissions=read:leads,write:tags  # comma-separated permissions
  &system_slug=grex-id        # target system slug
  &redirect_origin=https://myapp.com  # origin for postMessage reply
```

**Full flow:**

1. **External app** (running in a browser) calls:
   ```javascript
   const popup = window.open(
     `${platformBaseUrl}/oauth/authorize?client_name=MyApp&permissions=read:leads&system_slug=grex-id&redirect_origin=https://myapp.com`,
     "oauth",
     "popup,width=520,height=640",
   );
   window.addEventListener("message", (e) => {
     if (e.origin !== platformBaseUrl) return;
     const { token, error } = e.data;
     if (token) { /* store token, make API calls */ }
   });
   ```

2. **Authorization page** (`app/(auth)/oauth/authorize/page.tsx`):
   - Reads URL params: `client_name`, `permissions`, `system_slug`,
     `redirect_origin`.
   - If the user is **not authenticated**, redirects to
     `/login?oauth=1&client_name=...&permissions=...&system_slug=...&redirect_origin=...`
     to log in first, then continues to the authorize page.
   - If **authenticated**, shows:
     - App name and a company selector (the user picks which company to grant).
     - The requested permissions list.
     - **Authorize** and **Cancel** buttons.

3. **On Authorize** — the page calls `POST /api/auth/oauth/authorize`:
   - Backend verifies the user's system token.
   - Resolves `systemId` from `system_slug`.
   - Creates a `connected_app` record (tracks the authorization).
   - Creates an `api_token` record (the actual bearer credential) linked to the
     authorizing user, company, and system, with the granted permissions.
   - Returns `{ success: true, data: { token: "<raw>", app: { ... } } }`.
   - The page posts the token back:
     ```javascript
     window.opener.postMessage({ token }, redirectOrigin);
     window.close();
     ```

4. **On Cancel / Deny** — the page posts `{ error: "access_denied" }` back.

5. **Login page integration** (`app/(auth)/login/page.tsx`):
   - When `oauth=1` query param is present, after successful login the router
     pushes to `/oauth/authorize?...` (with all OAuth params) instead of
     `/usage`.

**Connected Apps page** (`src/components/shared/ConnectedAppsPage.tsx`):

- Shows all `connected_app` records for the current company+system.
- No manual "Add" button — apps are created exclusively through the OAuth flow.
- Each card shows: app name, granted permissions, creation date, and a
  **Revoke** button that calls `DELETE /api/connected-apps` and removes both the
  `connected_app` record and its associated `api_token`.
- An info box explains the OAuth flow and shows the authorization URL template
  so developers can copy it.

**Backend endpoint** (`app/api/auth/oauth/authorize/route.ts`):

```
POST /api/auth/oauth/authorize
Authorization: Bearer <system_token>
Body: {
  clientName: string;
  permissions: string;          // comma-separated
  systemSlug: string;
  companyId: string;
  redirectOrigin: string;
  monthlySpendLimit?: number;
}
Response: { success: true, data: { token: string, app: ConnectedApp } }
```

The raw token is sent once to the external app and never stored — only its
SHA-256 hash is kept in `api_token.tokenHash`.

### 16.2 Token management

Users can create API tokens via the "Tokens" menu. Each token:

- Has a name and description.
- Has selected granular permissions (free-text, comma-separated).
- Has an optional monthly spend limit.
- Has an optional expiry date.
- The raw token is shown **once** at creation in a copy modal and never again.
  Only the SHA-256 hash is stored.

### 16.3 subscribe action and admin role assignment

When a user subscribes (`POST /api/billing` with `action: "subscribe"`):

1. The `company_system` association is created **idempotently** — using an
   existence check so re-subscribing never throws a unique-constraint error.
2. The authenticated user's token is verified to extract `userId`.
3. If no `user_company_system` record exists for that
   `userId + companyId +
   systemId`, one is created with `roles: ["admin"]`.
   This ensures the company owner can always see the "Manage Users" sidebar item
   and perform admin operations.

---

## 17. Billing & Usage

### 17.1 Billing API

Route: `POST /api/billing` with `action` field in the request body.

**`action: "subscribe"`** — Creates a new subscription (or changes plan):

1. **Creates a `company_system` association** — links the company to the system.
   Uses an existence check before creating
   (`IF array::len(...) = 0 { CREATE
   company_system ... }`). This is the safe
   idempotent pattern — SurrealDB throws on `CREATE` with a duplicate unique
   key, so a raw `CREATE` must never be used here.
2. **If an active subscription already exists** for the company+system pair,
   updates it to `status = "cancelled"` in the same batched query.
3. **Creates a `subscription` record** — with the selected plan, period dates,
   and status `"active"`.
4. **Creates or skips `user_company_system`** — if the authenticated user has no
   context record for this company+system, one is created with
   `roles: ["admin"]` so they can manage users.

For **free plans** (price = 0), the `paymentMethodId` is omitted — the field is
`option<record<payment_method>>` so it defaults to `NONE`. For **paid plans**,
the `paymentMethodId` is required and the route returns a validation error if
missing.

**`action: "cancel"`** — Cancels the active subscription:

- Request body: `{ action: "cancel", companyId, systemId }`.
- Updates the subscription `status` to `"cancelled"`.
- Does NOT delete the `company_system` association — the company remains
  associated with the system but has no active plan.

**`action: "add_payment_method"`** — Adds a payment method:

- Request body:
  `{ action: "add_payment_method", companyId, cardToken,
  cardMask, holderName, holderDocument, billingAddress }`.
- Creates an `address` record for the billing address, then creates a
  `payment_method` record linked to it.
- If this is the first payment method for the company, sets `isDefault = true`.

**`action: "set_default_payment_method"`** — Sets default payment method:

- Request body:
  `{ action: "set_default_payment_method", companyId,
  paymentMethodId }`.
- Sets `isDefault = false` on all payment methods for the company, then sets
  `isDefault = true` on the specified one. Single batched query.

**`action: "remove_payment_method"`** — Removes a payment method:

- Request body: `{ action: "remove_payment_method", paymentMethodId }`.
- Deletes the payment method and its associated `address` record.
- If the deleted method was the default, sets the next available method as
  default.

**`action: "purchase_credits"`** — Purchases credits:

- Request body:
  `{ action: "purchase_credits", companyId, systemId, amount,
  paymentMethodId }`.
- Creates a `credit_purchase` record with `status = "pending"`.
- Publishes a `PAYMENT_DUE` event. The `process_payment` handler charges the
  payment method and updates the credit purchase status.
- On success, increments the company's credit balance via `usage_record` with
  `resource = "credits"`.

**`action: "apply_voucher"`** — Applies a voucher to the active subscription:

- Request body: `{ action: "apply_voucher", companyId, systemId, voucherCode }`.
- Validates: voucher exists, not expired, applicable to the company (or
  `applicableCompanyIds` is empty = universal).
- Adds the voucher ID to the subscription's `voucherIds` array.
- Returns the applied voucher details (modifiers) so the frontend can show the
  effect.

### 17.2 Billing page features

See Section 12.12.6 for the full UI specification.

### 17.3 Usage page features

See Section 12.12.7 for the full UI specification.

**Key architecture decisions:**

- **No API call tracking:** The usage page does not track or display API request
  counts. Rate limiting is enforced by middleware, not by usage tracking.
- **Storage usage via SurrealFS:** Storage consumption is calculated by
  traversing the company+system file tree using `@hviana/surreal-fs`
  `fs.readDir()` recursively and summing file sizes. The backend query function
  (`server/db/queries/usage.ts`) caches this calculation and returns it as part
  of the usage response.
- **Credit expenses via daily containers:** Each resource that consumes credits
  is identified by an i18n key. Backend operations call `trackCreditExpense()`
  from `server/utils/credit-tracker.ts` after consuming a resource. Daily
  containers (`credit_expense` table) are aggregated by the usage API to produce
  period totals per resource key.
- **Monthly aggregation:** The usage API accepts a date range (max 31 days) and
  aggregates `credit_expense` records within that range, grouping by
  `resourceKey` and summing `amount`.

### 17.4 Spend limits

Users, tokens, and connected apps can have an optional `monthlySpendLimit`.
Before any chargeable operation, the system checks that the actor's current
month usage + operation cost ≤ `monthlySpendLimit` (if set).

### 17.5 Credit deduction system

Credits are consumed by system-specific operations identified by i18n resource
keys. Each plan includes a `planCredits` field — temporary credits valid only
during the plan's recurrence period. When the subscription is created or
renewed, `remainingPlanCredits` on the subscription is set to
`plan.planCredits`. These credits expire when the period ends.

**Deduction priority (handled by `server/utils/credit-tracker.ts`):**

1. **Plan credits first** — decrement `subscription.remainingPlanCredits`.
2. **Purchased credits second** — if plan credits are exhausted, decrement from
   the company's purchased credit balance (`usage_record` with
   `resource = "credits"`).
3. **Insufficient credits** — if neither source has enough credits, the
   operation is rejected and an email alert is triggered.

**Credit deduction function contract:**

```typescript
// server/utils/credit-tracker.ts

export interface CreditDeductionResult {
  success: boolean;
  source: "plan" | "purchased" | "insufficient";
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
}

/**
 * Attempts to consume credits for an operation. Checks if there are
 * sufficient credits (plan + purchased combined), deducts from plan
 * credits first, then purchased. If insufficient, publishes the
 * "insufficient credits" email (once per exhaustion cycle).
 *
 * All operations are performed in a single batched db.query() call
 * to ensure atomicity.
 *
 * @returns CreditDeductionResult indicating success/failure and source
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
}): Promise<CreditDeductionResult>;
```

**Deduction algorithm (single batched query):**

1. Fetch the active subscription for the company+system pair.
2. Fetch the company's purchased credit balance.
3. Compute total available = `remainingPlanCredits` + purchased balance.
4. If `total < amount`:
   - If `creditAlertSent = false`, publish a `SEND_EMAIL` event with the
     `insufficient-credit` template and set `creditAlertSent = true` on the
     subscription.
   - Return `{ success: false, source: "insufficient" }`.
5. If `remainingPlanCredits >= amount`:
   - Decrement `remainingPlanCredits` by `amount`.
   - Record the expense in `credit_expense` (daily container).
   - Return `{ success: true, source: "plan" }`.
6. If `remainingPlanCredits < amount` but total is sufficient:
   - Use all remaining plan credits.
   - Decrement the remainder from purchased credits.
   - Record the expense in `credit_expense` (daily container).
   - Return `{ success: true, source: "purchased" }`.

**Credit alert email (one-shot mechanism):**

The `creditAlertSent` flag on the subscription ensures the "insufficient
credits" email is sent **exactly once** per exhaustion cycle. The flag is reset
to `false` in two scenarios:

1. **Credit purchase** — when `POST /api/billing` with
   `action: "purchase_credits"` completes successfully, the billing route sets
   `creditAlertSent = false` on the active subscription.
2. **Plan renewal** — when the recurring billing job renews a subscription
   (updates `currentPeriodStart`/`currentPeriodEnd` and resets
   `remainingPlanCredits` to `plan.planCredits`), it also sets
   `creditAlertSent = false`.

This prevents email spam while ensuring the user is notified each time credits
run out after a replenishment.

**Insufficient credit email template:**

File: `server/utils/communication/templates/insufficient-credit.ts`

The template receives: `name` (user/company name), `systemName`, `resourceKey`
(the operation that failed), `purchaseLink` (URL to the billing page). It uses
the shared `emailLayout()` wrapper and resolves all text via `t()` from
`templates.insufficientCredit.*` keys.

The email design features:

- A prominent warning emoji (⚠️) header.
- Clear explanation that credits are exhausted.
- The specific resource that triggered the alert (translated via `t()`).
- A large, gradient CTA button linking to the billing/credits page.
- A secondary text explaining that plan credits will renew on the next billing
  cycle.

### 17.6 Plan credits on subscription lifecycle

**On subscribe** (`action: "subscribe"`):

- The billing route fetches `plan.planCredits` and sets
  `subscription.remainingPlanCredits = plan.planCredits`.

**On renewal** (recurring billing job):

- `remainingPlanCredits` is reset to `plan.planCredits`.
- `creditAlertSent` is reset to `false`.

**On cancel** (`action: "cancel"`):

- Plan credits are forfeited (not refunded). `remainingPlanCredits` stays as-is
  on the cancelled subscription record for audit purposes.

**On plan change** (subscribe to a different plan):

- The old subscription is cancelled (credits forfeited).
- The new subscription starts with the new plan's `planCredits`.

---

## 18. Charts System

Every page within a system can include charts using `react-chartjs-2`. The
pattern:

```typescript
import { Bar, Line, Pie } from "react-chartjs-2";
```

Charts are rendered inside glassmorphism cards following the visual standard.
Data is fetched from system-specific API routes.

---

## 19. Terms of Acceptance (LGPD)

Every system must have its own terms of acceptance that include LGPD (Brazilian
General Data Protection Law) compliance text. The core provides a generic
fallback term via the `terms.generic` core setting, but each system can override
it with system-specific terms stored in the `System.termsOfService` field.

### 19.1 Terms resolution

The terms text is resolved in the following order:

1. `System.termsOfService` — system-specific terms (if non-empty).
2. `terms.generic` core setting — generic fallback terms.
3. If both are empty, a hardcoded i18n key `common.terms.fallback` is displayed.

### 19.2 Where terms acceptance is mandatory

Terms acceptance (a mandatory checkbox) is required in the following flows:

1. **User registration** (`/register` page): The registration form displays a
   checkbox with the terms text (or a link to view them). The checkbox must be
   checked before the form can be submitted. The backend validates that
   `termsAccepted: true` is included in the request body and rejects
   registration with a validation error if missing.

2. **Public lead registration/update** (`/api/leads/public`): The public lead
   creation endpoint requires `termsAccepted: true` in the request body. The
   frontend form that submits to this endpoint (e.g. the system's public
   homepage lead form) must include the terms checkbox. The backend rejects
   requests where `termsAccepted` is not `true`.

### 19.3 Terms display

The terms content is HTML stored in the database. On the frontend, the terms are
displayed inside a scrollable container (max-height with overflow-y-auto) above
the acceptance checkbox. The checkbox label uses an i18n key
(`auth.register.termsAccept` / `common.terms.accept`).

Below the terms acceptance checkbox, a **"View Terms of Service"** link is
displayed. This link opens the public terms page (`/terms?system=<slug>`) in a
new browser tab, allowing the user to read the full terms in a dedicated page
without leaving the registration flow.

### 19.4 Terms API

The public system info endpoint (`GET /api/public/system`) includes the resolved
terms text in its response:

```typescript
export interface PublicSystemInfo {
  name: string;
  slug: string;
  logoUri: string;
  defaultLocale?: string;
  termsOfService?: string; // Resolved: system-specific or generic fallback
}
```

This allows any public page to display the correct terms without authentication.

### 19.5 Public terms page

File: `app/(auth)/terms/page.tsx`

A dedicated public page that renders the full terms of service for a system.
Accessible at `/terms?system=<slug>` without authentication. This page is
designed to be opened in a new tab from the registration and lead forms.

The page:

1. Reads `?system=<slug>` from the URL.
2. Fetches the system's public info via `/api/public/system?slug=<slug>`.
3. Displays the system branding (logo + name) at the top.
4. Renders the resolved terms HTML content in a full-width, readable layout.
5. If no terms are available, displays the `common.terms.fallback` i18n text.
6. Includes `LocaleSelector` for language switching.

### 19.6 Core admin terms management

File: `app/(core)/terms/page.tsx` Component:
`src/components/core/TermsEditor.tsx`

The core admin panel includes a dedicated **"Terms"** page accessible from the
core sidebar (emoji: 📜, nav key: `core.nav.terms`). This page provides a
centralized interface for managing terms of service content, separate from the
system edit form.

The page contains:

1. **Generic terms card**: A special card at the top for the generic fallback
   terms (`terms.generic` core setting). This is always visible. It has an edit
   button that opens a modal with a large textarea to edit the generic terms
   HTML content.
2. **System terms list**: Below the generic card, a list of all systems showing
   whether each has custom terms or is using the generic fallback. Each system
   card has:
   - System name and slug.
   - A status badge indicating "Custom Terms" or "Using Generic".
   - An edit button that opens a modal with a searchable system field
     (pre-filled, read-only in edit mode) and a very large textarea for the
     terms HTML content.
3. **Create button**: Opens a modal with a searchable system field (using the
   same debounced search dropdown pattern from DataDeletion) and a large
   textarea. Selecting a system and saving updates that system's
   `termsOfService` field.

**API route**: `GET /api/core/terms` returns all systems with their terms
status. `PUT /api/core/terms` accepts `{ systemId, termsOfService }` to update a
system's terms, or `{ generic: true, content }` to update the generic fallback
setting.

### 19.7 SystemForm update

The core admin `SystemForm` includes a textarea field for `termsOfService` (HTML
content). This allows the superuser to configure system-specific terms. The
field label uses `core.systems.termsOfService` i18n key.

---

## 20. Delete Company and System Data

The superuser core admin panel includes a **"Delete Data"** page accessible from
the core sidebar. This feature permanently deletes all data associated with a
specific company and system pair, including uploaded files.

### 20.1 Core admin page

File: `app/(core)/data-deletion/page.tsx` Component:
`src/components/core/DataDeletion.tsx`

The page contains:

1. **Company search** (`SearchField`): A debounced search field that queries
   companies by name. Results appear in a dropdown. Selecting a company sets the
   target company.
2. **System search** (`SearchField`): A debounced search field that queries
   systems by name. Results appear in a dropdown. Selecting a system sets the
   target system.
3. **Delete button**: Enabled only when both company and system are selected.
   Clicking opens the confirmation modal.

### 20.2 Confirmation modal

The deletion modal is a high-security confirmation flow:

1. **Warning message**: A prominent red warning explaining that this action is
   irreversible and will delete all data for the selected company+system pair,
   including users associations, leads, subscriptions, usage records, files, and
   all related records.
2. **Awareness checkbox**: The superuser must check a checkbox stating "I
   understand that this action is irreversible and all data will be permanently
   deleted" (`core.dataDeletion.awareness`).
3. **Password re-entry**: A password field where the superuser must re-enter
   their current password. This password is sent to the backend and verified via
   `crypto::argon2::compare()` before any deletion occurs.
4. **Delete button**: Enabled only when the awareness checkbox is checked and
   the password field is non-empty. Shows a spinner during the operation.
5. **Cancel button**: Closes the modal without any action.

### 20.3 Backend API

Route: `DELETE /api/core/data-deletion`

Request body:

```typescript
{
  companyId: string;
  systemId: string;
  password: string; // Superuser's current password for re-verification
}
```

The route:

1. Verifies the request is from a superuser via
   `withAuth({ roles: ["superuser"] })`.
2. Fetches the superuser's `passwordHash` from the database.
3. Verifies the provided password against the hash using
   `crypto::argon2::compare()`.
4. If password verification fails, returns 403.
5. If verified, executes the deletion query that removes all data for the
   company+system pair (Section 20.4).
6. Returns success response.

### 20.4 Deletion scope

The deletion query removes records from the following tables for the given
`companyId` + `systemId` pair:

- `company_system` — the association itself
- `user_company_system` — user associations for this company+system
- `subscription` — subscriptions for this company+system
- `lead_company_system` — lead associations for this company+system
- `usage_record` — usage records for this company+system
- `connected_app` — connected apps for this company+system
- `api_token` — API tokens for this company+system
- `credit_purchase` — credit purchases for this company+system
- `tag` — tags scoped to this company+system
- `menu_item` — menu items for this system (only if no other companies use it)
- All uploaded files under the `{companyId}/{systemSlug}/` path via
  `@hviana/surreal-fs` `fs.delete()` for each file found via `fs.readDir()`.

**Important:** This does NOT delete the company or system records themselves —
only the association and all scoped data. The company and system continue to
exist and can be re-associated later.

File: `server/db/queries/data-deletion.ts`

---

## 21. Implementation Plan

Phases are ordered by dependency. Each phase builds on the previous.

### Phase 1: Foundation

**Goal:** Project scaffold, database, and core infrastructure.

- [ ] Initialize Next.js 16 project with TypeScript strict mode.
- [ ] Configure TailwindCSS 4.2 with CSS variables (Section 3).
- [ ] Create `src/contracts/` with all interfaces (Section 6).
- [ ] Set up `server/db/connection.ts` with SurrealDB HTTP connection.
- [ ] Implement migration runner (`server/db/migrations/runner.ts`).
- [ ] Write all migration files (Section 7.3).
- [ ] Implement seed runner and superuser seed.
- [ ] Create `server/utils/Core.ts` singleton with server-only guard.
- [ ] Set up i18n structure with `en` and `pt-BR` base translations.

**Done when:** Migrations run, superuser exists, Core loads from DB.

### Phase 2: Authentication

**Goal:** Complete auth flow with security measures.

- [ ] Implement `@panva/jose` token utilities (`server/utils/token.ts`).
- [ ] Implement rate limiter (`server/utils/rate-limiter.ts`).
- [ ] Create all auth API routes (`/api/auth/*`).
- [ ] Create `BotProtection.tsx` component.
- [ ] Create auth pages: login, register (with mandatory LGPD terms checkbox),
      verify, forgot-password, reset-password.
- [ ] Implement verification request system with cooldowns.
- [ ] Implement terms of acceptance validation on register and public lead
      routes (Section 19).
- [ ] Implement `useAuth` hook.
- [ ] Set up event queue foundation (Phase 3 prerequisite: at minimum,
      `send_email` handler and verification/password-reset templates).

**Done when:** A user can register, verify, login, recover password, and receive
tokens.

### Phase 3: Event Queue

**Goal:** Full event queue system operational.

- [ ] Implement `publisher.ts`.
- [ ] Implement `registry.ts`.
- [ ] Implement `worker.ts` with claim, lease, backoff, and dead-letter logic.
- [ ] Create generic channel handlers: `send_email`, `send_sms`.
- [ ] Create communication templates (verification, password-reset, welcome).
- [ ] Create `server/jobs/start-event-queue.ts`.

**Done when:** Events are published, delivered, retried, and dead-lettered
correctly.

### Phase 4: Shared UI Components

**Goal:** All generic UI components ready for reuse.

- [ ] `Spinner`, `LocaleSelector`, `Modal`.
- [ ] `SearchField` with `useDebounce`.
- [ ] `GenericList`, `GenericListItem`, pagination controls.
- [ ] `CreateButton`, `EditButton`, `DeleteButton`.
- [ ] `FilterDropdown`, `DateRangeFilter`, `FilterBadge`.
- [ ] `FormModal`, `GenericFormButton`, `ErrorDisplay`.
- [ ] `FileUploadField`, `SearchableSelectField`, `DynamicKeyValueField`,
      `MultiBadgeField`.
- [ ] All subforms: `ProfileSubform`, `ContactSubform`, `PasswordSubform`,
      `AddressSubform`, `CompanyIdentificationSubform`, `CreditCardSubform`,
      `NameDescSubform`.

**Done when:** All components render correctly in isolation with mock data.

### Phase 5: Core Admin Panel

**Goal:** Superuser can manage all core entities.

- [ ] Implement middleware pipeline (`compose.ts`, `withAuth`, `withRateLimit`,
      `withPlanAccess`, `withEntityLimit`).
- [ ] Create core API routes: systems, roles, plans, vouchers, menus, settings.
- [ ] Create core backend queries.
- [ ] Create core UI pages: systems (with FileUploadField for logo), roles,
      plans, vouchers — all using MultiBadgeField for array fields.
- [ ] Create MenuTreeEditor: per-system tree with inline add, drag-and-drop
      reordering, edit modal, incomplete config badge.
- [ ] Create SettingsEditor: key-value editor with missing settings detection.
- [ ] Create TermsEditor page: system terms list, generic fallback editor,
      searchable system selector, large textarea, and public terms page link.
- [ ] Create DataDeletion page: company/system search, confirmation modal with
      password re-entry, awareness checkbox, and backend verification.
- [ ] Create public terms page: `/terms?system=<slug>` for viewing terms in a
      new tab from registration and lead forms.
- [ ] Ensure all core page labels use i18n keys (no hardcoded English text).
- [ ] Implement component registry and menu → component mapping.

**Done when:** Superuser can create systems, roles, plans, menus, settings, and
delete company+system data via UI.

### Phase 6: Multi-Tenant User Flow & Subsystem Panel

**Goal:** Users can create companies, choose systems, subscribe to plans, and
use a fully functional subsystem panel with proper system branding.

- [ ] Onboarding pages: company creation, system selection with rich plan cards
      (Section 12.12.2), plan subscription.
- [ ] Post-login onboarding guard in `(app)` layout: redirect to
      `/onboarding/company` if no companies, `/onboarding/system` if no system
      subscriptions.
- [ ] Company API routes and queries.
- [ ] `Sidebar`, `SidebarMenuItem` (recursive), `SidebarSearch`.
- [ ] `ProfileMenu` with company/system switcher (Section 12.9).
- [ ] `useSystemContext` with `companies`, `systems` lists, `switchCompany()`,
      `switchSystem()`, and cookie persistence (`core_company`, `core_system`).
- [ ] App layout with system logo, sidebar, profile menu, content area. Default
      context: first company + first system.
- [ ] **Fix sidebar branding:** The `(app)` layout must pass the active system's
      logo URI (resolved via `/api/files/download?uri=...`) and name to the
      Sidebar. The sidebar must never show "Core" — it must always reflect the
      active system (Section 12.12.1).
- [ ] **Load menus from API:** Fetch custom menus from
      `GET /api/core/menus?systemId=...` filtered by user roles and plan, then
      append the hardcoded shared default menus (usage, billing, users,
      company-edit, connected-apps, tokens) with offset sort orders so they
      always appear after system-specific items (Section 12.12.1).

**Done when:** A user can register, create a company, subscribe to a plan, see
the subsystem panel with correct system branding (logo + name in sidebar), and
switch between companies/systems via ProfileMenu.

### Phase 7: Billing & Payment

**Goal:** Complete billing lifecycle operational.

- [ ] Billing API routes: all actions specified in Section 17.1 (subscribe,
      cancel, add/remove/set-default payment method, purchase credits, apply
      voucher).
- [ ] Billing backend queries (`server/db/queries/billing.ts`): subscribe (with
      plan change handling), cancel, payment method CRUD, credit purchase,
      voucher application.
- [ ] Implement client-side payment tokenization
      (`client/utils/payment/credit-card.ts`).
- [ ] Implement server-side payment provider
      (`server/utils/payment/credit-card.ts`).
- [ ] BillingPage UI (Section 12.12.6): current plan with cancel, available
      plans with rich cards, payment methods CRUD, credits purchase + history,
      voucher application.
- [ ] Plan cards (Section 12.12.2): rich design with benefits, limits,
      permissions. Used in both onboarding and billing pages.

**Done when:** Users can subscribe/cancel/change plans, manage payment methods,
buy credits, and apply vouchers through the billing page.

### Phase 8: Usage, Storage & Credit Tracking

**Goal:** Usage tracking with storage calculation and credit expense monitoring.

- [ ] Create `credit_expense` migration
      (`server/db/migrations/0032_create_credit_expense.surql`).
- [ ] Implement `server/utils/credit-tracker.ts` with `trackCreditExpense()`
      using daily containers and UPSERT.
- [ ] Implement storage usage calculation using `@hviana/surreal-fs`
      `fs.readDir()` to sum file sizes under `{companyId}/{systemSlug}/`.
- [ ] Usage API route (`GET /api/usage`): returns storage (used + limit) and
      credit expenses aggregated by resource key within date range (max 31
      days).
- [ ] UsagePage UI (Section 12.12.7): storage bar chart (used vs. limit), credit
      expense column chart with translated resource keys, date range filter (max
      1 month), summary table.
- [ ] Remove API call tracking from usage page — only storage and credit
      expenses are displayed.

**Done when:** The usage page shows real storage consumption from SurrealFS and
credit expenses as a column chart with per-resource breakdown.

### Phase 8.5: Connected Apps, Tokens & Users CRUD

**Goal:** Full CRUD operations for subsystem panel entity pages.

- [ ] **UsersPage** (Section 12.12.3): create/edit/delete users with admin role.
      Create user with ContactSubform + PasswordSubform + ProfileSubform +
      MultiBadgeField for roles. Edit profile/roles/phone. Delete removes
      `user_company_system` association only.
- [ ] **TokensPage** (Section 12.12.4): create tokens with NameDescSubform +
      MultiBadgeField for permissions + optional spend limit + expiry. Show raw
      token once on creation. Delete with confirmation.
- [ ] **ConnectedAppsPage** (Section 12.12.5): create/edit/delete connected apps
      with name, permissions, optional spend limit.
- [ ] Connected apps OAuth popup flow for external app connections.
- [ ] Spend limit enforcement: check actor's monthly usage before chargeable
      operations.

**Done when:** Admin users can manage users (create/edit/delete), any user can
manage their tokens (create/delete) and connected apps (create/edit/delete),
with spend limits enforced.

### Phase 9: Live Queries & Real-Time

**Goal:** Frontend real-time updates via SurrealDB WebSocket.

- [ ] Implement `client/db/connection.ts` with WebSocket.
- [ ] Implement `useLiveQuery` hook.
- [ ] Define frontend query files with `LIVE SELECT` and proper `PERMISSIONS`.
- [ ] Integrate live queries into relevant UI components.

**Done when:** UI updates in real-time when data changes.

### Phase 10: Recurring Billing Job

**Goal:** Automated subscription billing.

- [ ] Implement `recurring-billing.ts` job.
- [ ] Integrate with `process_payment` event handler.
- [ ] Handle `past_due` status and grace periods.
- [ ] Create `server/jobs/index.ts` to start all jobs.

**Done when:** Subscriptions are automatically billed at recurrence intervals.

---

## 22. Technical Decisions & Trade-offs

| Decision                                           | Rationale                                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SurrealDB HTTP for backend, WebSocket for frontend | Serverless environments support HTTP; WebSocket is needed only for live queries in the browser.                                                 |
| In-memory rate limiter                             | Serverless instances share no state; rate limits are per-instance approximations. For strict enforcement, migrate to a database-backed counter. |
| Cursor-based pagination (never SKIP)               | Consistent performance regardless of dataset size; no missed/duplicated records on concurrent writes.                                           |
| Event queue in SurrealDB (not external broker)     | Reduces infrastructure dependencies. Suitable for moderate throughput. If throughput exceeds SurrealDB capacity, migrate to an external broker. |
| Core singleton with reload                         | Avoids repeated DB queries for config. Trade-off: stale data for a brief moment during reload. Acceptable for configuration data.               |
| Argon2 via SurrealDB built-in                      | Avoids native module dependencies. Password hashing/verification happens inside the database.                                                   |
| No custom CSS beyond variables                     | Enforces design consistency. TailwindCSS utilities cover all styling needs.                                                                     |
| Emojis instead of icons                            | Zero dependency on icon libraries. Works everywhere.                                                                                            |
| `@panva/jose` for JWTs                             | Pure JavaScript, works in all serverless runtimes. No native dependencies.                                                                      |
| `react-chartjs-2` for charts                       | Flexible, well-documented, supports all chart types needed for usage and system pages.                                                          |
