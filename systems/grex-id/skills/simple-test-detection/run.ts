import "server-only";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import dbConfig from "../../../../database.json" with { type: "json" };

if (!dbConfig.test) {
  throw new Error(
    "database.json has test=false. This skill requires test to be true in database.json to avoid running against a production database.",
  );
}

const BASE = "http://localhost:3000";
const DB_URL: string = dbConfig.url;
const DB_AUTH = Buffer.from(`${dbConfig.user}:${dbConfig.pass}`).toString(
  "base64",
);

const RUN_ID = Date.now().toString(36);
const T1_DOC = `t1-detection-${RUN_ID}`;
const T2_DOC = `t2-detection-${RUN_ID}`;

const TEST_LEAD_NAMES = [
  "Public Lead T1",
  "Public Lead T2",
  "Auth Lead T1",
  "Auth Lead T2",
  "Suppressed Lead T1",
];

const SU_EMAIL = "core@admin.com";
const SU_PASSWORD = "core1234";

// ── Helpers ──

async function dbQuery(sql: string) {
  const res = await fetch(DB_URL + "/sql", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Accept": "application/json",
      "surreal-ns": dbConfig.namespace,
      "surreal-db": dbConfig.database,
      "Authorization": `Basic ${DB_AUTH}`,
    },
    body: sql,
  });
  return res.json();
}

async function api(
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
) {
  const opts: Record<string, unknown> = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (token) {
    (opts.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${method} ${path} returned non-JSON (status ${res.status}): ${
        text.slice(0, 500)
      }`,
    );
  }
}

function log(
  label: string,
  data: { success?: boolean; data?: Record<string, unknown>; error?: unknown },
) {
  if (data.success) {
    console.log(`  ✓ ${label}: ${data.data?.id || "OK"}`);
  } else {
    console.log(`  ✗ ${label}: ${JSON.stringify(data.error)}`);
  }
}

async function loginUser(
  identifier: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  }).then((r) => r.json());
  if (!res.success) {
    throw new Error(
      `Login failed for ${identifier}: ${JSON.stringify(res.error)}`,
    );
  }
  return res.data.systemToken;
}

async function exchangeToken(
  token: string,
  companyId: string,
  systemId: string,
): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ companyId, systemId }),
  }).then((r) => r.json());
  if (!res.success) {
    throw new Error(`Exchange failed: ${JSON.stringify(res.error)}`);
  }
  return res.data.systemToken;
}

// ── Step 0: Resolve dynamic IDs ──

async function resolveDynamicIds() {
  console.log("=== Step 0: Resolve dynamic IDs ===");

  // System by slug
  const [sysResult] = await dbQuery(
    "SELECT id FROM system WHERE slug = 'grex-id' LIMIT 1",
  );
  const systemRows = sysResult?.result ?? [];
  const systemId = systemRows[0]?.id as string | undefined;
  if (!systemId) {
    throw new Error("grex-id system not found");
  }
  console.log(`  ✓ System: ${systemId}`);

  // System-level tenant for grex-id
  const [stResult] = await dbQuery(
    `SELECT id FROM tenant WHERE !actorId AND !companyId AND systemId = ${systemId} LIMIT 1`,
  );
  const stRows = stResult?.result ?? [];
  const systemTenantId = stRows[0]?.id as string | undefined;
  if (!systemTenantId) {
    throw new Error("grex-id system tenant not found");
  }
  console.log(`  ✓ System tenant: ${systemTenantId}`);

  // Standard plan
  const [planResult] = await dbQuery(
    `SELECT id FROM plan WHERE name = 'plans.grexId.standard.name' AND tenantIds CONTAINS ${systemTenantId} LIMIT 1`,
  );
  const planRows = planResult?.result ?? [];
  const planId = planRows[0]?.id as string | undefined;
  if (!planId) {
    throw new Error("Standard plan not found for grex-id");
  }
  console.log(`  ✓ Plan: ${planId}`);

  // Roles by name
  const roleResults = await dbQuery(
    `SELECT id, name FROM role WHERE name IN ['grexid.detect', 'grexid.list_locations', 'admin'] AND tenantIds CONTAINS ${systemTenantId}`,
  );
  const roleRows = (roleResults?.[0]?.result ?? []) as {
    id: string;
    name: string;
  }[];
  const rolesByName: Record<string, string> = {};
  for (const r of roleRows) {
    rolesByName[r.name] = r.id;
  }
  console.log(
    `  ✓ Roles: detect=${rolesByName["grexid.detect"]}, list_locations=${
      rolesByName["grexid.list_locations"]
    }, admin=${rolesByName["admin"]}`,
  );

  return { systemId, planId, rolesByName };
}

// ── Clean all test data ──

async function cleanAll(companyIds: string[]) {
  console.log("\n=== Clean: Delete all test data ===");

  if (companyIds.length === 0) {
    console.log("  (no companies to clean)");
    return;
  }

  const cIds = companyIds.join(", ");
  const leadNames = TEST_LEAD_NAMES.map((n) => `'${n}'`).join(", ");

  const results = await dbQuery(`
    LET $cIds = [${cIds}];
    LET $leads = (SELECT id, profileId, channelIds FROM lead WHERE name IN [${leadNames}]);
    LET $leadIds = (SELECT VALUE id FROM $leads);
    LET $profiles = (SELECT VALUE profileId FROM $leads WHERE profileId != NONE);
    LET $channelArrays = (SELECT VALUE channelIds FROM $leads WHERE channelIds != NONE);
    LET $channels = array::flatten($channelArrays);

    DELETE grexid_detection WHERE leadId IN $leadIds;
    DELETE face WHERE leadId IN $leadIds;
    DELETE verification_request WHERE ownerId IN $leadIds;
    DELETE lead WHERE id IN $leadIds;
    DELETE profile WHERE id IN $profiles;
    DELETE entity_channel WHERE id IN $channels;
    DELETE location WHERE name = 'Main Lobby';
    DELETE api_token WHERE id != api_token:anonymous;
    DELETE subscription WHERE tenantIds CONTAINSANY (SELECT VALUE id FROM tenant WHERE companyId IN $cIds);
    DELETE tenant WHERE companyId IN $cIds;
    DELETE company WHERE id IN $cIds;
  `);

  for (const r of results) {
    if (r.status === "ERR") {
      console.error(`  ✗ Clean failed: ${r.result}`);
      process.exit(1);
    }
  }
  console.log("  ✓ All test data cleaned");
}

// ── Main ──

async function main() {
  // Step 0: Resolve dynamic IDs
  const { systemId, planId, rolesByName } = await resolveDynamicIds();
  const adminRoleId = rolesByName["admin"];
  const detectRoleId = rolesByName["grexid.detect"];
  const listLocRoleId = rolesByName["grexid.list_locations"];

  if (!adminRoleId || !detectRoleId || !listLocRoleId) {
    throw new Error("Required roles not found");
  }

  const companyIds: string[] = [];

  // Step 1: Get anonymous token
  console.log("\n=== Step 1: Get anonymous token ===");
  const anonResp = await fetch(`${BASE}/api/public/anonymous-token`).then((r) =>
    r.json()
  );
  const anon = anonResp.data.token;
  console.log("  ✓ Anonymous token");

  // Step 2: Login as superuser
  console.log("\n=== Step 2: Login as superuser ===");
  let suToken = await loginUser(SU_EMAIL, SU_PASSWORD);
  console.log("  ✓ Superuser token");

  // Step 3: Create Company T1
  console.log("\n=== Step 3: Create Company T1 ===");
  const t1CompanyResp = await api("POST", "/api/companies", suToken, {
    name: "Test T1 - Detection",
    document: T1_DOC,
    documentType: "system",
    billingAddress: {},
  });
  if (!t1CompanyResp.success) {
    throw new Error(
      `T1 company creation failed: ${JSON.stringify(t1CompanyResp.error)}`,
    );
  }
  const t1CompanyId = t1CompanyResp.data.id as string;
  companyIds.push(t1CompanyId);
  console.log(`  ✓ T1 Company: ${t1CompanyId}`);

  // Step 4: Create Company T2
  console.log("\n=== Step 4: Create Company T2 ===");
  const t2CompanyResp = await api("POST", "/api/companies", suToken, {
    name: "Test T2 - Detection",
    document: T2_DOC,
    documentType: "system",
    billingAddress: {},
  });
  if (!t2CompanyResp.success) {
    throw new Error(
      `T2 company creation failed: ${JSON.stringify(t2CompanyResp.error)}`,
    );
  }
  const t2CompanyId = t2CompanyResp.data.id as string;
  companyIds.push(t2CompanyId);
  console.log(`  ✓ T2 Company: ${t2CompanyId}`);

  // Step 5: Subscribe T1 to standard plan + create API tokens
  console.log("\n=== Step 5: Subscribe T1 + create API tokens ===");
  suToken = await loginUser(SU_EMAIL, SU_PASSWORD);
  const t1SuToken = await exchangeToken(suToken, t1CompanyId, systemId);

  const t1SubResp = await api("POST", "/api/billing", t1SuToken, {
    action: "subscribe",
    planId,
  });
  if (!t1SubResp.success) {
    throw new Error(
      `T1 subscription failed: ${JSON.stringify(t1SubResp.error)}`,
    );
  }
  console.log("  ✓ T1 subscribed");

  const t1AdminResp = await api("POST", "/api/tokens", t1SuToken, {
    name: "T1 Admin",
    description: "T1 admin token for detection testing",
    resourceLimits: { roleIds: [adminRoleId] },
    neverExpires: true,
  });
  if (!t1AdminResp.success || !t1AdminResp.data?.token) {
    throw new Error(
      `T1 admin token creation failed: ${JSON.stringify(t1AdminResp.error)}`,
    );
  }
  const t1Admin = t1AdminResp.data.token as string;
  console.log("  ✓ T1 admin API token");

  const t1DetectResp = await api("POST", "/api/tokens", t1SuToken, {
    name: "T1 Detect",
    description: "T1 detect API token for detection testing",
    resourceLimits: { roleIds: [detectRoleId, listLocRoleId] },
    neverExpires: true,
  });
  if (!t1DetectResp.success || !t1DetectResp.data?.token) {
    throw new Error(
      `T1 detect token creation failed: ${JSON.stringify(t1DetectResp.error)}`,
    );
  }
  const t1Detect = t1DetectResp.data.token as string;
  console.log("  ✓ T1 detect API token");

  // Step 6: Subscribe T2 to standard plan + create API token
  console.log("\n=== Step 6: Subscribe T2 + create API token ===");
  suToken = await loginUser(SU_EMAIL, SU_PASSWORD);
  const t2SuToken = await exchangeToken(suToken, t2CompanyId, systemId);

  const t2SubResp = await api("POST", "/api/billing", t2SuToken, {
    action: "subscribe",
    planId,
  });
  if (!t2SubResp.success) {
    throw new Error(
      `T2 subscription failed: ${JSON.stringify(t2SubResp.error)}`,
    );
  }
  console.log("  ✓ T2 subscribed");

  const t2AdminResp = await api("POST", "/api/tokens", t2SuToken, {
    name: "T2 Admin",
    description: "T2 admin token for detection testing",
    resourceLimits: { roleIds: [adminRoleId] },
    neverExpires: true,
  });
  if (!t2AdminResp.success || !t2AdminResp.data?.token) {
    throw new Error(
      `T2 admin token creation failed: ${JSON.stringify(t2AdminResp.error)}`,
    );
  }
  const t2Admin = t2AdminResp.data.token as string;
  console.log("  ✓ T2 admin API token");

  // Load vectors
  const vectors = JSON.parse(
    readFileSync(join(__dirname, "grexid_vectors.json"), "utf8"),
  );
  console.log(
    `\nLoaded ${vectors.length} vectors of ${vectors[0].length} dimensions`,
  );

  // ── Step 7: Create location in T1 ──
  console.log("\n=== Step 7: Create location in T1 ===");
  const locResp = await api("POST", "/api/systems/grex-id/locations", t1Admin, {
    name: "Main Lobby",
    address: {
      street: "Main St",
      number: "123",
      city: "Sao Paulo",
      state: "SP",
      postalCode: "01001000",
      country: "BR",
    },
  });
  const locId = locResp.data?.id;
  if (!locId) {
    console.error(
      "  ✗ Location creation failed:",
      JSON.stringify(locResp.error),
    );
    await cleanAll(companyIds);
    process.exit(1);
  }
  console.log(`  ✓ Location: ${locId}`);

  // ── Step 8: List locations via detect API token ──
  console.log("\n=== Step 8: List locations via detect API token ===");
  const locList = await api(
    "GET",
    "/api/systems/grex-id/locations",
    t1Detect,
  );
  console.log(
    `  ✓ Locations listed: ${
      locList.success ? "OK" : JSON.stringify(locList.error)
    }`,
  );

  // ── Step 9: Create public lead in T1 (V1) ──
  console.log("\n=== Step 9: Create public lead in T1 (V1) ===");
  const pub1 = await api("POST", "/api/systems/grex-id/leads/public", anon, {
    name: "Public Lead T1",
    companyId: t1CompanyId,
    channels: [{ type: "email", value: "pub-t1@test.com" }],
    termsAccepted: true,
    botToken: "test-bypass",
    profile: { name: "Public Lead T1" },
    faceDescriptor: vectors[0],
    acceptsCommunication: true,
  });
  log("Public Lead T1", pub1);

  // ── Step 10: Create public lead in T2 (V2) ──
  console.log("\n=== Step 10: Create public lead in T2 (V2) ===");
  const pub2 = await api("POST", "/api/systems/grex-id/leads/public", anon, {
    name: "Public Lead T2",
    companyId: t2CompanyId,
    channels: [{ type: "email", value: "pub-t2@test.com" }],
    termsAccepted: true,
    botToken: "test-bypass",
    profile: { name: "Public Lead T2" },
    faceDescriptor: vectors[1],
    acceptsCommunication: true,
  });
  log("Public Lead T2", pub2);

  // ── Step 11: Create auth lead in T1 (V3) ──
  console.log("\n=== Step 11: Create auth lead in T1 (V3) ===");
  const auth1 = await api("POST", "/api/systems/grex-id/leads", t1Admin, {
    name: "Auth Lead T1",
    channels: [
      { type: "email", value: "auth-t1@test.com" },
      { type: "phone", value: "11999990001" },
    ],
    profile: { name: "Auth Lead T1" },
    faceDescriptor: vectors[2],
    acceptsCommunication: true,
  });
  log("Auth Lead T1", auth1);

  // ── Step 12: Create auth lead in T2 (V4) ──
  console.log("\n=== Step 12: Create auth lead in T2 (V4) ===");
  const auth2 = await api("POST", "/api/systems/grex-id/leads", t2Admin, {
    name: "Auth Lead T2",
    channels: [
      { type: "email", value: "auth-t2@test.com" },
      { type: "phone", value: "11999990002" },
    ],
    profile: { name: "Auth Lead T2" },
    faceDescriptor: vectors[3],
    acceptsCommunication: true,
  });
  log("Auth Lead T2", auth2);

  // ── Step 13: Create suppressed lead in T1 (V6, acceptsCommunication=false) ──
  console.log(
    "\n=== Step 13: Create suppressed lead in T1 (V6, acceptsCommunication=false) ===",
  );
  const supp = await api("POST", "/api/systems/grex-id/leads", t1Admin, {
    name: "Suppressed Lead T1",
    channels: [
      { type: "email", value: "suppressed-t1@test.com" },
      { type: "phone", value: "11999990003" },
    ],
    profile: { name: "Suppressed Lead T1" },
    faceDescriptor: vectors[5],
    acceptsCommunication: false,
  });
  log("Suppressed Lead T1", supp);

  // ── Step 14: Call detect API (call 1) with all 6 vectors ──
  console.log("\n=== Step 14: Call detect API (call 1) ===");
  const detect1 = await api("POST", "/api/systems/grex-id/detect", t1Detect, {
    locationId: locId,
    embeddings: vectors,
  });
  console.log(
    `  ✓ Detect 1: ${detect1.success ? "OK" : JSON.stringify(detect1.error)}`,
  );

  console.log("\n  Waiting 10s for event processing...");
  await new Promise((r) => setTimeout(r, 10000));

  // ── Step 15: Call detect API (call 2) ──
  console.log("\n=== Step 15: Call detect API (call 2) ===");
  const detect2 = await api("POST", "/api/systems/grex-id/detect", t1Detect, {
    locationId: locId,
    embeddings: vectors,
  });
  console.log(
    `  ✓ Detect 2: ${detect2.success ? "OK" : JSON.stringify(detect2.error)}`,
  );

  console.log("\n  Waiting 10s for event processing...");
  await new Promise((r) => setTimeout(r, 10000));

  // ── Step 16: Query detection report ──
  console.log("\n=== Step 16: Query detection report ===");
  const now = new Date();
  const start =
    new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
  const end = now.toISOString().split("T")[0];

  const report = await api(
    "GET",
    `/api/systems/grex-id/detections?action=stats&startDate=${start}&endDate=${end}`,
    t1Admin,
  );

  if (!report.success) {
    console.error("\n  ✗ Report failed:", JSON.stringify(report.error));
    await cleanAll(companyIds);
    process.exit(1);
  }

  const data = report.data;
  console.log("\n  Report:");
  console.log(`    uniqueMembers: ${data.uniqueMembers}`);
  console.log(`    uniqueVisitors: ${data.uniqueVisitors}`);
  console.log(`    uniqueUnknowns: ${data.uniqueUnknowns}`);
  console.log(`    uniqueSuppressed: ${data.uniqueSuppressed}`);
  console.log(`    individuals: ${data.individuals?.length}`);

  const members = data.individuals?.filter(
    (i: Record<string, unknown>) => i.classification === "member",
  ) || [];
  const visitors = data.individuals?.filter(
    (i: Record<string, unknown>) => i.classification === "visitor",
  ) || [];
  const unknowns = data.individuals?.filter(
    (i: Record<string, unknown>) => i.classification === "unknown",
  ) || [];
  const suppressed = data.individuals?.filter(
    (i: Record<string, unknown>) => i.classification === "suppressed",
  ) || [];

  console.log("\n  Members:", members.length);
  members.forEach((m: Record<string, unknown>) =>
    console.log(`    - leadId=${m.leadId} detections=${m.detectionCount}`)
  );

  console.log("  Visitors:", visitors.length);
  visitors.forEach((v: Record<string, unknown>) =>
    console.log(`    - leadId=${v.leadId} detections=${v.detectionCount}`)
  );

  console.log("  Unknowns:", unknowns.length);
  unknowns.forEach((u: Record<string, unknown>) =>
    console.log(`    - detections=${u.detectionCount}`)
  );

  console.log("  Suppressed:", suppressed.length);
  suppressed.forEach((s: Record<string, unknown>) =>
    console.log(`    - leadId=${s.leadId} detections=${s.detectionCount}`)
  );

  // ── Step 17: Verify results ──
  console.log("\n=== Step 17: Verify results ===");
  const errors: string[] = [];

  if (members.length !== 2) {
    errors.push(`Expected 2 members, got ${members.length}`);
  }
  if (visitors.length !== 2) {
    errors.push(`Expected 2 visitors, got ${visitors.length}`);
  }
  if (unknowns.length !== 1) {
    errors.push(`Expected 1 unknown, got ${unknowns.length}`);
  }
  if (suppressed.length !== 1) {
    errors.push(`Expected 1 suppressed, got ${suppressed.length}`);
  }

  members.forEach((m: Record<string, unknown>) => {
    if (m.detectionCount !== 2) {
      errors.push(
        `Member ${m.leadId} has ${m.detectionCount} detections, expected 2`,
      );
    }
  });
  visitors.forEach((v: Record<string, unknown>) => {
    if (v.detectionCount !== 2) {
      errors.push(
        `Visitor ${v.leadId} has ${v.detectionCount} detections, expected 2`,
      );
    }
  });
  unknowns.forEach((u: Record<string, unknown>) => {
    if (u.detectionCount !== 2) {
      errors.push(`Unknown has ${u.detectionCount} detections, expected 2`);
    }
  });
  suppressed.forEach((s: Record<string, unknown>) => {
    if (s.detectionCount !== 2) {
      errors.push(
        `Suppressed ${s.leadId} has ${s.detectionCount} detections, expected 2`,
      );
    }
  });

  // ── Clean all test data ──
  await cleanAll(companyIds);

  if (errors.length) {
    console.log("\n  ✗ VERIFICATION ERRORS:");
    errors.forEach((e) => console.log(`    - ${e}`));
    process.exit(1);
  } else {
    console.log("\n  ✓ ALL VERIFICATIONS PASSED!");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
