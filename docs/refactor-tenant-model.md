# Tenant Model Refactoring Plan

## Context

The system previously used `"0"` sentinel values for `companyId`, `systemId`,
and `actorId` to represent "unauthenticated / non-tenant" contexts, plus a
synthetic anonymous tenant constructed at runtime. This has been replaced by a
model where:

- The **core** has a real `company` and `system` record (seeded at boot).
- All roles live in the `role` table: `superuser` and `anonymous` for core,
  `admin` per subsystem.
- An **anonymous user** exists as a real `user` (no profile, no channels, no
  password) with a long-lived `api_token:anonymous` carrying the core tenant
  with the `anonymous` role.
- `TenantActorType` no longer includes `"anonymous"` — the anonymous user's API
  token is `actorType: "api_token"`.
- **Every** `Tenant` has real SurrealDB record IDs. Zero sentinels, zero
  synthetic tenants.

## Critical Principle: Single-Token Rule (Frontend)

The frontend stores **only** the opaque JWT string. No React context, hook,
component state, or prop stores `companyId`, `systemId`, `userId`, `roles`, or
`permissions` independently. All tenant context is derived from
`useAuth().tenant` (which decodes the token). Every `fetch` wrapper attaches
`Authorization: Bearer <token>`.

When no user token is stored (logged out), the frontend fetches the anonymous
token from `GET /api/public/anonymous-token` and uses that as the bearer for
public operations. There is never a state where the frontend makes API calls
without a bearer token (except auth routes).

---

## Phase 1: Contracts & Types

### Step 1.1 — Update `src/contracts/tenant.ts`

- Remove `"anonymous"` from `TenantActorType`.
- Remove all `"0"` comments from `systemId`, `companyId`, `actorId`.
- Every field is a real value; add a comment stating "all values are real
  SurrealDB record IDs — no sentinels".

### Step 1.2 — Verify no other contract files reference `"anonymous"` actor type

- Check `src/contracts/verification-request.ts` (line 8 has `| "anonymous"`).
- Update any found.

---

## Phase 2: Server Utilities

### Step 2.1 — Rewrite `server/utils/tenant.ts`

- **Delete** `getAnonymousTenant()`. This function no longer exists. All callers
  must be updated in later steps.
- **Rewrite** `getSystemTenant()`: instead of hardcoded `"0"` IDs, read the core
  company and system IDs from the Core data cache. The function becomes async
  (or accepts the core data as a parameter). Return real IDs with the
  `superuser` role.
- Keep `assertScope()` unchanged.

### Step 2.2 — Rewrite `server/utils/actor-validity.ts`

- **Remove** the `"0"` guard in `loadTenantPartition` (line 45):
  `if (companyId === "0" || systemId === "0")` → delete this branch entirely.
  The anonymous user's API token is loaded at boot like every other token.
- All partitions correspond to real `(company, system)` pairs.

### Step 2.3 — Update `server/utils/token.ts`

- `verifyTenantToken` (line 93-100): remove all `?? "0"` fallbacks. Replace with
  empty-string or throw if the claim is missing (a valid token always has real
  values). Remove `actorId: (payload.actorId as string) ?? "0"` →
  `actorId: payload.actorId as string` (throw if absent — invalid token).

---

## Phase 3: Middleware

### Step 3.1 — Rewrite `server/middleware/withAuth.ts`

This is the most critical change. Current flow:

1. No `Authorization` header → synthesize anonymous tenant via
   `getAnonymousTenant(systemSlug)`.
2. Has token → verify JWT, check validity.

**New flow:**

1. No `Authorization` header AND route is NOT an auth route (`/api/auth/*`) →
   return 401. Every non-auth route requires a bearer token.
2. No `Authorization` header AND route IS an auth route → proceed without
   populating `ctx.tenant`/`ctx.claims` (set tenant to a minimal placeholder
   that won't be used, or leave undefined — auth routes only use
   `withRateLimit`).
3. Has token → verify JWT, check validity (unchanged).

- **Remove** the import of `getAnonymousTenant`.
- **Remove** the entire `if (!authHeader?.startsWith("Bearer "))` block that
  synthesizes an anonymous tenant. Replace with: if no bearer and not an auth
  route, return 401. Auth routes proceed without tenant context.

### Step 3.2 — Update `server/middleware/compose.ts`

- **Remove** the import of `getAnonymousTenant`.
- **Remove** the default `tenant: getAnonymousTenant("core")` in the
  `RequestContext` initialization. Replace with
  `tenant: null as unknown as
  Tenant` or a minimal object that will never be
  read (auth routes don't use tenant context, and all other routes require a
  token).

### Step 3.3 — Update `server/middleware/withRateLimit.ts`

- **Remove** the `"0"` checks (lines 15-16):
  `ctx.tenant.companyId !== "0" && ctx.tenant.systemId !== "0"`. Tenant IDs are
  always real. The rate-limit key is always `{companyId}:{systemId}`. Auth
  routes continue using `{ip}`.

---

## Phase 4: Server Queries & Route Handlers

### Step 4.1 — Update `server/db/queries/tokens.ts`

- **Remove** `if (params.companyId && params.companyId !== "0")` (line 52).
  Replace with unconditional tenant isolation — `companyId` is always real.

### Step 4.2 — Update `server/db/queries/billing.ts`

- **Replace** `actorType = "user", actorId = "0"` (lines 951, 1185) with the
  actual anonymous user's actor ID or remove the hardcoded "0" — these should
  use the real actor ID from the tenant claims.

### Step 4.3 — Update `server/db/queries/usage.ts`

- Search for any `"0"` sentinel usage in usage queries. All `companyId` and
  `systemId` values are now real.

### Step 4.4 — Update `server/utils/credit-tracker.ts`

- Search for `"0"` sentinel usage. Ensure all `companyId`/`systemId` parameters
  are real IDs.

### Step 4.5 — Update `app/api/files/upload/route.ts`

- **Replace** `const userId = ctx.claims?.actorId ?? "0"` (line 65) with
  `const userId = ctx.claims.actorId`. The `claims` object is always populated
  for non-auth routes (the anonymous user's token provides it).

### Step 4.6 — Update `app/api/leads/public/route.ts`

- **Replace** `actorType: "anonymous"` (lines 190, 290) with
  `actorType:
  claims.actorType` or remove the hardcoded anonymous tenant
  construction. The route now receives a real tenant from the anonymous user's
  token via `withAuth`.

### Step 4.7 — Update all other route handlers using `"0"` sentinels

Search exhaustively:

```
grep -rn '"0"' server/ app/api/ --include='*.ts'
```

For each match, determine if it's a sentinel (tenant context) or a legitimate
value (like a setting value `"0"` meaning unlimited). Fix only sentinels.

---

## Phase 5: Frontend

### Step 5.1 — Update `src/hooks/useAuth.tsx`

- **Remove** `"0"` fallbacks in `extractTenant` (lines 75-76) and
  `extractClaims` (lines 91-92, 97). If the token payload is missing these
  values, the token is invalid — return a proper default or throw.
- **Remove** the anonymous default tenant (lines 247-253). When no token is
  stored, the frontend should fetch the anonymous token from
  `GET /api/public/anonymous-token`.
- **Add** logic in the `AuthProvider` mount effect: if no user token exists in
  cookies, fetch `/api/public/anonymous-token` and store the result as the
  bearer for public operations (separate from the user token cookie). This
  anonymous token is sent on every public API call.
- The `tenant` memo should derive from whichever token is active (user token or
  anonymous token). When logged out, it shows the core tenant with the anonymous
  role. When logged in, it shows the user's actual tenant.

### Step 5.2 — Update `src/hooks/useSystemContext.ts`

- Ensure it reads only from `useAuth().tenant` — no loose tenant variables.

### Step 5.3 — Audit all frontend components

- Search for any component that receives `companyId`, `systemId`, `userId`, or
  `roles` as props and uses them independently instead of deriving from
  `useAuth()` or `useSystemContext()`.
- Key files to check:
  - `src/components/subforms/ProfileSubform.tsx` — receives `companyId`,
    `userId` as props. Ensure these come from the token-derived tenant, not from
    loose state.
  - `src/components/core/RoleForm.tsx` — `useState` for `systemId`. Should come
    from context or be derived from the active token.

---

## Phase 6: New Public Endpoint

### Step 6.1 — Create `app/api/public/anonymous-token/route.ts`

- `GET` handler, no auth required.
- Reads the seeded `api_token:anonymous` record from the DB.
- Issues a JWT with the anonymous user's tenant context (core company, core
  system, anonymous role, `actorType: "api_token"`, `exchangeable: false`).
- Returns `{ success: true, data: { token: "<jwt>" } }`.
- This JWT is verifiable by `withAuth` like any other token.
- The anonymous token's actor ID (`api_token:anonymous`) is loaded into the
  actor-validity cache at boot.

---

## Phase 7: Core Data Cache

### Step 7.1 — Update `server/utils/Core.ts`

- The Core data cache loader must also load and expose the core company ID and
  core system ID (needed by `getSystemTenant()`).
- Add `coreCompanyId` and `coreSystemId` to the cached data.

### Step 7.2 — Update `server/utils/file-cache.ts`

- **Remove** the `"core"` special key for anonymous/unmatched systems. The
  anonymous user's token provides real tenant IDs. File cache keys are always
  `<realCompanyId>:<realSystemSlug>`.

---

## Phase 8: Communication Templates

### Step 8.1 — Update email/SMS templates if they reference `"0"` sentinels

- `server/utils/communication/templates/email/human-confirmation.ts`
- `server/utils/communication/templates/email/notification.ts`
- `server/utils/communication/templates/email/layout.ts`
- Search each for `"0"` and replace with real values from tenant context.

---

## Phase 9: Final Sweep & Verification

### Step 9.1 — Exhaustive `"0"` sentinel grep

```bash
grep -rn '"0"' server/ app/api/ src/ --include='*.ts' --include='*.tsx'
```

Categorize every match:

- **Setting value** (like `value: "0"` meaning unlimited) → keep.
- **Tenant sentinel** → fix.
- **Non-tenant "0"** (like `"X-RateLimit-Remaining": "0"`) → keep.

### Step 9.2 — Exhaustive `"anonymous"` actor type grep

```bash
grep -rn '"anonymous"' server/ app/api/ src/ --include='*.ts' --include='*.tsx'
```

Every match should be:

- A role name reference (`roles: ["anonymous"]`) → keep.
- An actor type → remove/replace.

### Step 9.3 — Remove all `getAnonymousTenant` imports and calls

```bash
grep -rn 'getAnonymousTenant' server/ app/api/ src/ --include='*.ts'
```

Every reference must be gone. The function no longer exists.

### Step 9.4 — Update `src/contracts/tenant.ts` one final time

Ensure the contract matches the final implementation:

- No `"anonymous"` in `TenantActorType`.
- No `"0"` comments.
- All fields documented as real SurrealDB record IDs.

### Step 9.5 — Run type-check

```bash
npx tsc --noEmit
```

Fix all type errors resulting from the removed `"anonymous"` actor type and
`getAnonymousTenant` function.

### Step 9.6 — Wipe DB and re-seed

The seeds have been updated. Wipe the database and run migrations + seeds from
scratch to verify the new core company, core system, roles, superuser, and
anonymous user are created correctly.

### Step 9.7 — Smoke test

1. Login as superuser → verify core tenant context.
2. Access a public page → verify anonymous token is fetched and used.
3. Upload a file anonymously → verify real companyId/userId in path.
4. Submit a lead publicly → verify real tenant context.
5. Exchange tenant → verify real IDs in new token.
