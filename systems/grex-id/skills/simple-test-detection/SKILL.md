---
name: simple-test-detection
description: End-to-end test for the grex-id detection pipeline covering the full multi-tenant flow — dynamic company/tenant/subscription setup, lead creation (public + authenticated), suppressed lead (acceptsCommunication=false), face descriptor matching, detection event processing, and tenant-scoped classification (member/visitor/unknown/suppressed).
---

## Prerequisites

- Dev server running at `http://localhost:3000`
- `database.json` must have `"test": true`
- Superuser seeded (`core@admin.com` / `core1234`)
- grex-id system seeded with roles (`admin`, `grexid.detect`,
  `grexid.list_locations`) and standard plan

## How to run

```
node --conditions=react-server systems/grex-id/skills/simple-test-detection/run.ts
```

## Scenario

Two tenants (companies T1 and T2), each subscribed to grex-id via the standard
plan. All companies, tenants, subscriptions, and API tokens are created
dynamically at test time — no hardcoded record IDs.

1. **Resolve IDs** — queries DB for the grex-id system ID, standard plan ID, and
   role IDs (admin, grexid.detect, grexid.list_locations) by name
2. **Anonymous token** — obtains the anonymous API token for public operations
3. **Superuser** — logs in as the seeded superuser
4. **Companies** — creates T1 and T2 companies via API with proper data
5. **Subscriptions** — subscribes both companies to the grex-id standard plan
   (free, 30-day recurrence) via the billing API
6. **API tokens** — creates admin-scoped API tokens for T1 and T2, and a
   detect-scoped API token for T1
7. **Location** — creates a location in T1 via the authenticated route
8. **List locations** — verifies the detect API token can list locations
9. **Public leads** — creates two leads via the public endpoint (anonymous
   token), one per tenant, each with a face descriptor and
   `acceptsCommunication: true`
10. **Authenticated leads** — creates two leads via the auth endpoint, one per
    tenant, each with a face descriptor and `acceptsCommunication: true`
11. **Suppressed lead** — creates an authenticated lead in T1 with
    `acceptsCommunication: false` (the 6th vector)
12. **Detect** — calls the detect API twice with all 6 vectors
13. **Report** — queries detection stats from T1's perspective
14. **Verify** — asserts classification counts and per-individual detection
    counts
15. **Clean** — deletes all test data (companies, tenants, subscriptions, API
    tokens, leads, faces, detections, locations, profiles, channels,
    verification requests)

## Vectors

| Index | Vector | Lead               | Tenant | acceptsCommunication | Classification (T1 view) |
| ----- | ------ | ------------------ | ------ | -------------------- | ------------------------ |
| V1    | 0      | Public Lead T1     | T1     | true                 | member                   |
| V2    | 1      | Public Lead T2     | T2     | true                 | visitor                  |
| V3    | 2      | Auth Lead T1       | T1     | true                 | member                   |
| V4    | 3      | Auth Lead T2       | T2     | true                 | visitor                  |
| V5    | 4      | (unregistered)     | —      | —                    | unknown                  |
| V6    | 5      | Suppressed Lead T1 | T1     | false                | suppressed               |

## Expected results

When all assertions pass (`✓ ALL VERIFICATIONS PASSED!`):

| Classification | Count  | Meaning                                                                                    |
| -------------- | ------ | ------------------------------------------------------------------------------------------ |
| **Members**    | 2      | T1 leads (public + auth) with `acceptsCommunication: true`                                 |
| **Visitors**   | 2      | T2 leads — detected but not in T1's tenant; `leadId` hidden for tenant isolation           |
| **Suppressed** | 1      | T1 lead with `acceptsCommunication: false` — in T1's scope but opted out of communications |
| **Unknowns**   | 1      | The 5th vector with no matching lead                                                       |
| **Detections** | 2 each | Two detect API calls per individual                                                        |

## Interpreting failures

- **Step 0 (resolve IDs)**: DB connectivity or seed data missing (grex-id
  system, standard plan, roles)
- **Step 1 (anonymous token)**: Anonymous API token not seeded
- **Step 2 (superuser)**: Superuser credentials or seed issue
- **Steps 3-4 (companies)**: Company creation API issue
- **Steps 5-6 (subscriptions + tokens)**: Billing/subscription or token creation
  issue
- **Step 7 (location)**: `csTenant` / generics create issue
- **Step 8 (list locations)**: Detect API token permissions issue
- **Steps 9-10 (public leads)**: Public lead endpoint or face descriptor storage
  issue
- **Steps 11-12 (auth leads)**: Authenticated lead route issue
- **Step 13 (suppressed lead)**: Lead creation with
  `acceptsCommunication: false` issue
- **Steps 14-15 (detect)**: Detection event handler issue — check server logs
- **Step 16 (report)**: Detection stats query issue (date range, GROUP BY,
  classification logic)
- **Step 17 (verify)**: Wrong classification counts or detection counts — likely
  a tenant-scoping or `acceptsCommunication` classification bug in the detection
  queries
- **Clean**: DB cascade issue — residual test data may require manual cleanup

## After execution — kill Next.js servers

This skill starts the Next.js dev server (`server start`). When you are done
testing, explicitly kill all running Next.js servers:

```bash
pkill -f "next dev" && pkill -f "next start"
```
