import "server-only";
import { Buffer } from "node:buffer";
import process from "node:process";
import dbConfig from "../../database.json" with { type: "json" };

// ── Configuration ──
// Set USER_EMAIL env var to override the default target user.
const USER_EMAIL = process.env.USER_EMAIL || "hv5088@gmail.com";

const DB_URL: string = dbConfig.url;
const DB_AUTH = Buffer.from(`${dbConfig.user}:${dbConfig.pass}`).toString(
  "base64",
);

const RUN_ID = Date.now().toString(36);

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `DB HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(
      `DB returned non-array: ${JSON.stringify(json).slice(0, 500)}`,
    );
  }
  return json;
}

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

/** Generate a random unit vector of `dim` dimensions. */
function randomEmbedding(dim = 1024): number[] {
  const v: number[] = [];
  for (let i = 0; i < dim; i++) {
    v.push(Math.random() * 2 - 1);
  }
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return v.map((x) => x / norm);
}

/** Return a random ISO datetime string between `daysBack` days ago and now. */
function randomDatetime(daysBack: number): string {
  const now = Date.now();
  const past = now - daysBack * 86400000;
  return new Date(past + Math.random() * (now - past)).toISOString();
}

/** Build a SurrealDB array literal from a number array. */
function surqlArray(arr: number[]): string {
  return `[${arr.join(",")}]`;
}

// ── Main ──

async function main() {
  console.log(`=== Dummy detection data for ${USER_EMAIL} ===\n`);

  // ── Step 1: Resolve user, tenant, and company-system ──
  console.log("Step 1: Resolving user and tenant...");

  const resolveResults = await dbQuery(`
    LET $channel = (SELECT id FROM entity_channel
      WHERE type = 'email'
        AND value = '${esc(USER_EMAIL)}'
        AND verified = true
      LIMIT 1
    )[0];

    LET $user = (SELECT id FROM user
      WHERE channelIds CONTAINS $channel.id
      LIMIT 1
    )[0];

    LET $sys = (SELECT id FROM system
      WHERE slug = 'grex-id'
      LIMIT 1
    )[0];

    LET $tenant = (SELECT id, companyId, systemId FROM tenant
      WHERE actorId = $user.id
        AND systemId = $sys.id
      LIMIT 1
    )[0];

    LET $csTenant = IF $tenant {
      (SELECT id FROM tenant
        WHERE !actorId
          AND companyId = $tenant.companyId
          AND systemId = $tenant.systemId
        LIMIT 1
      )[0]
    } ELSE { NONE };

    RETURN {
      channelId: $channel.id,
      userId: $user.id,
      systemId: $sys.id,
      tenantId: $tenant.id,
      tenantCompanyId: $tenant.companyId,
      tenantSystemId: $tenant.systemId,
      csTenantId: $csTenant.id,
    };
  `);

  // The RETURN statement is the last result in the array
  const resolveResult = resolveResults[resolveResults.length - 1];

  // Validate in TypeScript for clear error messages
  const status = (resolveResult as any)?.status;
  if (status === "ERR") {
    console.error("  DB error:", (resolveResult as any)?.result);
    process.exit(1);
  }

  // SurrealDB RETURN may produce result as an object directly or as [object]
  const raw = resolveResult?.result;
  const resolved = (Array.isArray(raw) ? raw[0] : raw) as
    | Record<string, unknown>
    | undefined;
  if (!resolved) {
    console.error("  Failed to resolve user/tenant: empty result");
    process.exit(1);
  }
  if (!resolved.channelId) {
    console.error(`  No verified email channel found for ${USER_EMAIL}`);
    process.exit(1);
  }
  if (!resolved.userId) {
    console.error(`  No user found with email ${USER_EMAIL}`);
    process.exit(1);
  }
  if (!resolved.systemId) {
    console.error("  grex-id system not found — is the system seeded?");
    process.exit(1);
  }
  if (!resolved.tenantId) {
    console.error(
      `  No grex-id tenant found for ${USER_EMAIL}. Make sure the user is subscribed to grex-id.`,
    );
    process.exit(1);
  }
  if (!resolved.csTenantId) {
    console.error(
      "  No company-system tenant found for grex-id. Is the company subscribed?",
    );
    process.exit(1);
  }

  const companyId = resolved.tenantCompanyId as string;
  const systemId = resolved.tenantSystemId as string;
  const csTenantId = resolved.csTenantId as string;

  console.log(`  ✓ User: ${resolved.userId}`);
  console.log(`  ✓ User tenant: ${resolved.tenantId}`);
  console.log(`  ✓ Company: ${companyId}`);
  console.log(`  ✓ System: ${systemId}`);
  console.log(`  ✓ Company-system tenant: ${csTenantId}`);

  // ── Step 1b: Create second company for visitor classification ──
  console.log("\nStep 1b: Creating second company for visitors...");

  const [visitorCoRes] = await dbQuery(`
    CREATE company SET
      name = 'Dummy Visitor Co ${RUN_ID}',
      document = 'visitor-${RUN_ID}',
      documentType = 'system'
  `);
  const visitorCompanyId = (visitorCoRes?.result?.[0] as any)?.id as
    | string
    | undefined;
  if (!visitorCompanyId) {
    console.error(
      "  Failed to create visitor company:",
      JSON.stringify(visitorCoRes),
    );
    process.exit(1);
  }
  console.log(`  ✓ Visitor company: ${visitorCompanyId}`);

  const [visitorCsRes] = await dbQuery(`
    CREATE tenant SET
      actorId = NONE,
      companyId = ${visitorCompanyId},
      systemId = ${systemId}
  `);
  const visitorCsTenantId = (visitorCsRes?.result?.[0] as any)?.id as
    | string
    | undefined;
  if (!visitorCsTenantId) {
    console.error(
      "  Failed to create visitor CS tenant:",
      JSON.stringify(visitorCsRes),
    );
    process.exit(1);
  }
  console.log(`  ✓ Visitor CS tenant: ${visitorCsTenantId}`);

  // ── Step 1c: Create visitor leads (second company) ──
  console.log("\nStep 1c: Creating visitor leads...");

  const visitors = [
    { name: "Gabriel Ferreira", email: `gabriel-visitor-${RUN_ID}@dummy.com` },
    { name: "Helena Rocha", email: `helena-visitor-${RUN_ID}@dummy.com` },
  ];

  const visitorLeadIds: string[] = [];
  const visitorFaceIds: string[] = [];

  for (const v of visitors) {
    const emb = randomEmbedding();

    const [profRes] = await dbQuery(
      `CREATE profile SET name = '${esc(v.name)}'`,
    );
    const profileId = (profRes?.result?.[0] as any)?.id as string | undefined;
    if (!profileId) {
      console.error(`  ✗ Failed to create profile for ${v.name}`);
      continue;
    }

    const [chanRes] = await dbQuery(
      `CREATE entity_channel SET type = 'email', value = '${
        esc(v.email)
      }', verified = true`,
    );
    const channelId = (chanRes?.result?.[0] as any)?.id as string | undefined;
    if (!channelId) {
      console.error(`  ✗ Failed to create channel for ${v.name}`);
      continue;
    }

    const [leadRes] = await dbQuery(`
      CREATE lead SET
        name = '${esc(v.name)}',
        profileId = ${profileId},
        channelIds = <set> [${channelId}],
        tenantIds = <set> [${visitorCsTenantId}],
        acceptsCommunication = true
    `);
    const leadId = (leadRes?.result?.[0] as any)?.id as string | undefined;
    if (!leadId) {
      console.error(`  ✗ Failed to create lead for ${v.name}`);
      continue;
    }

    const [faceRes] = await dbQuery(`
      CREATE face SET
        embedding_type1 = ${surqlArray(emb)},
        leadId = ${leadId}
    `);
    const faceId = (faceRes?.result?.[0] as any)?.id as string | undefined;
    if (!faceId) {
      console.error(`  ✗ Failed to create face for ${v.name}`);
      continue;
    }

    visitorLeadIds.push(leadId);
    visitorFaceIds.push(faceId);
    console.log(`  ✓ Visitor: ${v.name} → lead=${leadId} face=${faceId}`);
  }

  // ── Step 2: Create location ──
  console.log("\nStep 2: Creating location...");

  const [locRes] = await dbQuery(`
    CREATE location SET
      name = 'Dummy HQ ${RUN_ID}',
      tenantIds = <set> [${csTenantId}],
      address = {
        street: 'Av. Paulista',
        number: '1000',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        postalCode: '01310100'
      }
  `);
  const locationId = (locRes?.result?.[0] as any)?.id as string | undefined;
  if (!locationId) {
    console.error("  Failed to create location:", JSON.stringify(locRes));
    process.exit(1);
  }
  const locId: string = locationId;
  console.log(`  ✓ Location: ${locationId}`);

  // ── Step 3: Create member leads (acceptsCommunication=true) ──
  console.log("\nStep 3: Creating member leads...");

  const members = [
    { name: "Alice Silva", email: `alice-member-${RUN_ID}@dummy.com` },
    { name: "Bob Santos", email: `bob-member-${RUN_ID}@dummy.com` },
    { name: "Carla Oliveira", email: `carla-member-${RUN_ID}@dummy.com` },
    { name: "David Costa", email: `david-member-${RUN_ID}@dummy.com` },
  ];

  const memberLeadIds: string[] = [];
  const memberFaceIds: string[] = [];

  for (const m of members) {
    const emb = randomEmbedding();

    // Create profile
    const [profRes] = await dbQuery(
      `CREATE profile SET name = '${esc(m.name)}'`,
    );
    const profileId = (profRes?.result?.[0] as any)?.id as string | undefined;
    if (!profileId) {
      console.error(`  ✗ Failed to create profile for ${m.name}`);
      continue;
    }

    // Create entity_channel
    const [chanRes] = await dbQuery(
      `CREATE entity_channel SET type = 'email', value = '${
        esc(m.email)
      }', verified = true`,
    );
    const channelId = (chanRes?.result?.[0] as any)?.id as string | undefined;
    if (!channelId) {
      console.error(`  ✗ Failed to create channel for ${m.name}`);
      continue;
    }

    // Create lead
    const [leadRes] = await dbQuery(`
      CREATE lead SET
        name = '${esc(m.name)}',
        profileId = ${profileId},
        channelIds = <set> [${channelId}],
        tenantIds = <set> [${csTenantId}],
        acceptsCommunication = true
    `);
    const leadId = (leadRes?.result?.[0] as any)?.id as string | undefined;
    if (!leadId) {
      console.error(`  ✗ Failed to create lead for ${m.name}`);
      continue;
    }

    // Create face
    const [faceRes] = await dbQuery(`
      CREATE face SET
        embedding_type1 = ${surqlArray(emb)},
        leadId = ${leadId}
    `);
    const faceId = (faceRes?.result?.[0] as any)?.id as string | undefined;
    if (!faceId) {
      console.error(`  ✗ Failed to create face for ${m.name}`);
      continue;
    }

    memberLeadIds.push(leadId);
    memberFaceIds.push(faceId);
    console.log(`  ✓ Member: ${m.name} → lead=${leadId} face=${faceId}`);
  }

  // ── Step 4: Create suppressed leads (acceptsCommunication=false) ──
  console.log("\nStep 4: Creating suppressed leads...");

  const suppressed = [
    { name: "Eve Pereira", email: `eve-suppressed-${RUN_ID}@dummy.com` },
    { name: "Frank Lima", email: `frank-suppressed-${RUN_ID}@dummy.com` },
  ];

  const suppressedLeadIds: string[] = [];
  const suppressedFaceIds: string[] = [];

  for (const s of suppressed) {
    const emb = randomEmbedding();

    const [profRes] = await dbQuery(
      `CREATE profile SET name = '${esc(s.name)}'`,
    );
    const profileId = (profRes?.result?.[0] as any)?.id as string | undefined;
    if (!profileId) {
      console.error(`  ✗ Failed to create profile for ${s.name}`);
      continue;
    }

    const [chanRes] = await dbQuery(
      `CREATE entity_channel SET type = 'email', value = '${
        esc(s.email)
      }', verified = true`,
    );
    const channelId = (chanRes?.result?.[0] as any)?.id as string | undefined;
    if (!channelId) {
      console.error(`  ✗ Failed to create channel for ${s.name}`);
      continue;
    }

    const [leadRes] = await dbQuery(`
      CREATE lead SET
        name = '${esc(s.name)}',
        profileId = ${profileId},
        channelIds = <set> [${channelId}],
        tenantIds = <set> [${csTenantId}],
        acceptsCommunication = false
    `);
    const leadId = (leadRes?.result?.[0] as any)?.id as string | undefined;
    if (!leadId) {
      console.error(`  ✗ Failed to create lead for ${s.name}`);
      continue;
    }

    const [faceRes] = await dbQuery(`
      CREATE face SET
        embedding_type1 = ${surqlArray(emb)},
        leadId = ${leadId}
    `);
    const faceId = (faceRes?.result?.[0] as any)?.id as string | undefined;
    if (!faceId) {
      console.error(`  ✗ Failed to create face for ${s.name}`);
      continue;
    }

    suppressedLeadIds.push(leadId);
    suppressedFaceIds.push(faceId);
    console.log(
      `  ✓ Suppressed: ${s.name} → lead=${leadId} face=${faceId}`,
    );
  }

  // ── Step 5: Create unknown faces (no lead attached) ──
  console.log("\nStep 5: Creating unknown faces...");

  const unknownFaceIds: string[] = [];
  const numUnknowns = 3;

  for (let i = 0; i < numUnknowns; i++) {
    const emb = randomEmbedding();
    const [faceRes] = await dbQuery(`
      CREATE face SET
        embedding_type1 = ${surqlArray(emb)}
    `);
    const faceId = (faceRes?.result?.[0] as any)?.id as string | undefined;
    if (faceId) {
      unknownFaceIds.push(faceId);
      console.log(`  ✓ Unknown face ${i + 1}: ${faceId}`);
    } else {
      console.error(`  ✗ Failed to create unknown face ${i + 1}`);
    }
  }

  // ── Step 6: Create detections spread across the last 7 days ──
  console.log("\nStep 6: Creating detections...");

  const daysBack = 7;
  const detectionsPerFace = 5;

  interface DetectionRow {
    locationId: string;
    leadId?: string;
    faceId: string;
    score: number;
    detectedAt: string;
  }

  const allDetectionRows: DetectionRow[] = [];

  function pushDetections(
    faceIds: string[],
    leadIds: string[],
    scoreMin: number,
    scoreMax: number,
    includeLead: boolean,
  ) {
    for (const [i, faceId] of faceIds.entries()) {
      for (let d = 0; d < detectionsPerFace; d++) {
        allDetectionRows.push({
          locationId: locId,
          leadId: includeLead ? leadIds[i] : undefined,
          faceId,
          score: scoreMin + Math.random() * (scoreMax - scoreMin),
          detectedAt: randomDatetime(daysBack),
        });
      }
    }
  }

  pushDetections(memberFaceIds, memberLeadIds, 0.85, 1.0, true);
  pushDetections(suppressedFaceIds, suppressedLeadIds, 0.80, 1.0, true);
  pushDetections(visitorFaceIds, visitorLeadIds, 0.80, 1.0, true);
  pushDetections(unknownFaceIds, [], 0.45, 0.80, false);

  // Build statements as individual CREATEs in a single batched query
  const statements = allDetectionRows.map((row) => {
    const leadPart = row.leadId ? `leadId = ${row.leadId},` : "";
    return `CREATE grexid_detection SET locationId = ${row.locationId}, ${leadPart} faceId = ${row.faceId}, score = ${row.score}, detectedAt = type::datetime('${row.detectedAt}')`;
  });

  // Execute in chunks of 20 to avoid query-length issues
  const CHUNK = 20;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const chunk = statements.slice(i, i + CHUNK).join(";\n");
    const results = await dbQuery(chunk);
    for (const r of results) {
      if (r.status === "ERR") {
        console.error(`  ✗ Detection batch ${i / CHUNK + 1} failed:`, r.result);
      }
    }
  }

  const totalDetections = allDetectionRows.length;
  const memberTotal = memberFaceIds.length * detectionsPerFace;
  const suppressedTotal = suppressedFaceIds.length * detectionsPerFace;
  const visitorTotal = visitorFaceIds.length * detectionsPerFace;
  const unknownTotal = numUnknowns * detectionsPerFace;
  console.log(`  ✓ Member detections: ${memberTotal}`);
  console.log(`  ✓ Suppressed detections: ${suppressedTotal}`);
  console.log(`  ✓ Visitor detections: ${visitorTotal}`);
  console.log(`  ✓ Unknown detections: ${unknownTotal}`);

  // ── Summary ──
  console.log("\n=== Summary ===");
  console.log(`  Location:       ${locationId}`);
  console.log(
    `  Members:        ${memberLeadIds.length} leads, ${memberFaceIds.length} faces`,
  );
  console.log(
    `  Suppressed:     ${suppressedLeadIds.length} leads, ${suppressedFaceIds.length} faces`,
  );
  console.log(
    `  Visitors:       ${visitorLeadIds.length} leads, ${visitorFaceIds.length} faces`,
  );
  console.log(`  Unknown faces:  ${unknownFaceIds.length}`);
  console.log(`  Total detections: ${totalDetections}`);
  console.log(`\n  Run ID: ${RUN_ID}`);
  console.log(`  User: ${USER_EMAIL}`);
  console.log(`  Company: ${companyId}`);
  console.log("\n  Data is ready. Check the detection reports in the UI.");
  console.log(
    `  To find this data later: leads with emails containing "-${RUN_ID}@dummy.com"`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
