import { getDb, rid } from "../db/connection.ts";
import { forgetActor, reloadTenant } from "./actor-validity.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("cascade-delete");

/**
 * Cascade deletion follows the dissociate → orphan-check → hard-delete cycle (§2.4.2).
 *
 * Every entity delete runs in one batched SurrealQL query:
 * 1. Dissociate — remove/clear parent references to the composable
 * 2. Orphan-check — query whether any other row still references it
 * 3. Hard-delete — if orphaned, delete the row and recurse into compositional children
 *
 * Shared data between tenants is only hard-deleted when orphaned across ALL tenants.
 */

export interface CascadeDeleteResult {
  deleted: boolean;
  orphaned: boolean;
  cascaded: string[];
}

async function batchedQuery<T extends unknown[] = unknown[]>(
  queries: string[],
  bindings: Record<string, unknown>,
): Promise<T> {
  const db = await getDb();
  const query = queries.join("\n");
  return db.query<T>(query, bindings);
}

// ---------------------------------------------------------------------------
// Composable deletes
// ---------------------------------------------------------------------------

export async function deleteProfile(
  profileId: string,
): Promise<CascadeDeleteResult> {
  const pid = rid(profileId);
  const queries = [
    // Dissociate from parents
    `UPDATE user SET profileId = NONE WHERE profileId = $pid;`,
    `UPDATE lead SET profileId = NONE WHERE profileId = $pid;`,
    // Orphan check
    `LET $orphan = (SELECT count() AS c FROM user WHERE profileId = $pid GROUP ALL).c = 0
     AND (SELECT count() AS c FROM lead WHERE profileId = $pid GROUP ALL).c = 0;`,
    // Delete recovery channels then profile if orphaned
    `IF $orphan THEN
       DELETE FROM entity_channel WHERE id IN (SELECT VALUE recoveryChannelIds FROM profile WHERE id = $pid LIMIT 1);
       DELETE FROM profile WHERE id = $pid;
     END;`,
  ];
  await batchedQuery(queries, { pid });
  return {
    deleted: true,
    orphaned: true,
    cascaded: ["entity_channel", "profile"],
  };
}

export async function deleteAddress(
  addressId: string,
): Promise<CascadeDeleteResult> {
  const aid = rid(addressId);
  const queries = [
    `UPDATE company SET billingAddressId = NONE WHERE billingAddressId = $aid;`,
    `UPDATE payment_method SET billingAddressId = NONE WHERE billingAddressId = $aid;`,
    `LET $orphan = (SELECT count() AS c FROM company WHERE billingAddressId = $aid GROUP ALL).c = 0
     AND (SELECT count() AS c FROM payment_method WHERE billingAddressId = $aid GROUP ALL).c = 0;`,
    `IF $orphan THEN DELETE FROM address WHERE id = $aid END;`,
  ];
  await batchedQuery(queries, { aid });
  return { deleted: true, orphaned: true, cascaded: ["address"] };
}

export async function deleteEntityChannel(
  channelId: string,
): Promise<CascadeDeleteResult> {
  const cid = rid(channelId);
  const queries = [
    `UPDATE user SET channelIds = channelIds.filter(|x| x != $cid) WHERE $cid IN channelIds;`,
    `UPDATE lead SET channelIds = channelIds.filter(|x| x != $cid) WHERE $cid IN channelIds;`,
    `UPDATE profile SET recoveryChannelIds = recoveryChannelIds.filter(|x| x != $cid) WHERE $cid IN recoveryChannelIds;`,
    `LET $orphan = (SELECT count() AS c FROM user WHERE $cid IN channelIds GROUP ALL).c = 0
     AND (SELECT count() AS c FROM lead WHERE $cid IN channelIds GROUP ALL).c = 0
     AND (SELECT count() AS c FROM profile WHERE $cid IN recoveryChannelIds GROUP ALL).c = 0;`,
    `IF $orphan THEN DELETE FROM entity_channel WHERE id = $cid END;`,
  ];
  await batchedQuery(queries, { cid });
  return { deleted: true, orphaned: true, cascaded: ["entity_channel"] };
}

// ---------------------------------------------------------------------------
// User cascade (§2.4.2)
// ---------------------------------------------------------------------------

export async function deleteUser(
  userId: string,
): Promise<CascadeDeleteResult> {
  const uid = rid(userId);
  const cascaded: string[] = [];

  // 1. Get user's composable references
  const [userResult] = await batchedQuery<
    [{ profileId: string; channelIds: string[] }[]]
  >([
    `SELECT profileId, channelIds FROM $uid;`,
  ], { uid });

  const user = userResult?.[0];
  if (!user) return { deleted: false, orphaned: false, cascaded: [] };

  const queries = [
    // 2. Delete oauth_identity rows
    `DELETE FROM oauth_identity WHERE userId = $uid;`,
    // 3. Remove entity_channels from channelIds, then orphan-check each
    `FOR $ch IN ${JSON.stringify(user.channelIds ?? [])} {
       UPDATE user SET channelIds = channelIds.filter(|x| x != $ch) WHERE id = $uid;
       LET $chOrphan = (SELECT count() AS c FROM user WHERE $ch IN channelIds GROUP ALL).c = 0
         AND (SELECT count() AS c FROM lead WHERE $ch IN channelIds GROUP ALL).c = 0
         AND (SELECT count() AS c FROM profile WHERE $ch IN recoveryChannelIds GROUP ALL).c = 0;
       IF $chOrphan THEN DELETE FROM entity_channel WHERE id = $ch END;
     };`,
    // 4. Delete profile (with its recovery channels)
    `IF ${user.profileId ? "true" : "false"} THEN
       UPDATE user SET profileId = NONE WHERE id = $uid;
       UPDATE lead SET profileId = NONE WHERE profileId = ${
      user.profileId ? `$profileId` : "NONE"
    };
       LET $pOrphan = (SELECT count() AS c FROM user WHERE profileId = $profileId GROUP ALL).c = 0
         AND (SELECT count() AS c FROM lead WHERE profileId = $profileId GROUP ALL).c = 0;
       IF $pOrphan THEN
         DELETE FROM entity_channel WHERE id IN (SELECT VALUE recoveryChannelIds FROM profile WHERE id = $profileId);
         DELETE FROM profile WHERE id = $profileId;
       END;
     END;`,
    // 5. Forget actor validity for all user's tenant rows, delete tenant_role + tenant rows
    `LET $userTenants = (SELECT id FROM tenant WHERE actorId = $uid);
     DELETE FROM tenant_role WHERE tenantId IN $userTenants[].id;
     DELETE FROM api_token WHERE id IN (SELECT VALUE apiTokenId FROM connected_app WHERE tenantId IN $userTenants[].id);
     DELETE FROM connected_app WHERE tenantId IN $userTenants[].id;
     DELETE FROM tenant WHERE actorId = $uid;`,
    // 6. Delete the user
    `DELETE FROM user WHERE id = $uid;`,
  ];

  await batchedQuery(queries, {
    uid,
    profileId: user.profileId ? rid(user.profileId) : undefined,
  });

  // Forget actor validity across all user's tenants
  await reloadTenant(userId);

  cascaded.push(
    "oauth_identity",
    "entity_channel",
    "profile",
    "tenant",
    "tenant_role",
    "api_token",
    "connected_app",
    "user",
  );
  return { deleted: true, orphaned: true, cascaded };
}

// ---------------------------------------------------------------------------
// Lead cascade (§2.4.2)
// ---------------------------------------------------------------------------

export async function deleteLead(
  leadId: string,
): Promise<CascadeDeleteResult> {
  const lid = rid(leadId);

  const [leadResult] = await batchedQuery<
    [{ profileId: string; channelIds: string[] }[]]
  >([
    `SELECT profileId, channelIds FROM $lid;`,
  ], { lid });

  const lead = leadResult?.[0];
  if (!lead) return { deleted: false, orphaned: false, cascaded: [] };

  const queries = [
    `FOR $ch IN ${JSON.stringify(lead.channelIds ?? [])} {
       UPDATE lead SET channelIds = channelIds.filter(|x| x != $ch) WHERE id = $lid;
       LET $chOrphan = (SELECT count() AS c FROM user WHERE $ch IN channelIds GROUP ALL).c = 0
         AND (SELECT count() AS c FROM lead WHERE $ch IN channelIds GROUP ALL).c = 0
         AND (SELECT count() AS c FROM profile WHERE $ch IN recoveryChannelIds GROUP ALL).c = 0;
       IF $chOrphan THEN DELETE FROM entity_channel WHERE id = $ch END;
     };`,
    `IF ${lead.profileId ? "true" : "false"} THEN
       UPDATE lead SET profileId = NONE WHERE id = $lid;
       LET $pOrphan = (SELECT count() AS c FROM user WHERE profileId = $profileId GROUP ALL).c = 0
         AND (SELECT count() AS c FROM lead WHERE profileId = $profileId GROUP ALL).c = 0;
       IF $pOrphan THEN
         DELETE FROM entity_channel WHERE id IN (SELECT VALUE recoveryChannelIds FROM profile WHERE id = $profileId);
         DELETE FROM profile WHERE id = $profileId;
       END;
     END;`,
    `DELETE FROM lead_company_system WHERE leadId = $lid;`,
    `DELETE FROM lead WHERE id = $lid;`,
  ];

  await batchedQuery(queries, {
    lid,
    profileId: lead.profileId ? rid(lead.profileId) : undefined,
  });

  return {
    deleted: true,
    orphaned: true,
    cascaded: ["entity_channel", "profile", "lead_company_system", "lead"],
  };
}

// ---------------------------------------------------------------------------
// Company cascade (§2.4.2)
// ---------------------------------------------------------------------------

export async function deleteCompany(
  companyId: string,
  fsDelete: (path: string[]) => Promise<void>,
): Promise<CascadeDeleteResult> {
  const cid = rid(companyId);
  const cascaded: string[] = [];

  const queries = [
    // Get billing address for cleanup
    `LET $billingAddr = (SELECT VALUE billingAddressId FROM company WHERE id = $cid)[0];`,
    // Get all tenant rows for this company
    `LET $companyTenants = (SELECT id FROM tenant WHERE companyId = $cid);`,
    // Delete subscriptions for company-system tenants
    `DELETE FROM subscription WHERE tenantId IN $companyTenants[].id;`,
    // Delete payment methods
    `DELETE FROM payment_method WHERE tenantId IN $companyTenants[].id;`,
    // Delete credit purchases and payments
    `DELETE FROM credit_purchase WHERE tenantId IN $companyTenants[].id;`,
    `DELETE FROM payment WHERE tenantId IN $companyTenants[].id;`,
    // Delete usage records and credit expenses
    `DELETE FROM usage_record WHERE tenantId IN $companyTenants[].id;`,
    `DELETE FROM credit_expense WHERE tenantId IN $companyTenants[].id;`,
    // Delete connected apps and their api_tokens
    `LET $appTenants = (SELECT id FROM tenant WHERE companyId = $cid AND actorType = 'connected_app');
     DELETE FROM api_token WHERE id IN (SELECT VALUE apiTokenId FROM connected_app WHERE tenantId IN $appTenants[].id);
     DELETE FROM connected_app WHERE tenantId IN $appTenants[].id;`,
    // Delete tenant_role entries and tenant rows
    `DELETE FROM tenant_role WHERE tenantId IN $companyTenants[].id;`,
    `DELETE FROM tenant WHERE companyId = $cid;`,
    // Delete lead_company_system rows
    `DELETE FROM lead_company_system WHERE companyId = $cid;`,
    // Delete address if orphaned
    `IF $billingAddr != NONE THEN
       UPDATE company SET billingAddressId = NONE WHERE id = $cid;
       LET $aOrphan = (SELECT count() AS c FROM company WHERE billingAddressId = $billingAddr GROUP ALL).c = 0
         AND (SELECT count() AS c FROM payment_method WHERE billingAddressId = $billingAddr GROUP ALL).c = 0;
       IF $aOrphan THEN DELETE FROM address WHERE id = $billingAddr END;
     END;`,
  ];

  await batchedQuery(queries, { cid });

  // Delete files via surreal-fs
  try {
    await fsDelete([companyId]);
  } catch {
    // File cleanup best-effort
  }

  cascaded.push(
    "subscription",
    "payment_method",
    "credit_purchase",
    "payment",
    "usage_record",
    "credit_expense",
    "connected_app",
    "api_token",
    "tenant_role",
    "tenant",
    "lead_company_system",
    "address",
    "file",
  );
  return { deleted: true, orphaned: true, cascaded };
}

// ---------------------------------------------------------------------------
// Tenant-scoped delete (for data-deletion admin surface)
// ---------------------------------------------------------------------------

export async function deleteTenantScopedData(
  tenantId: string,
  companyId: string,
  systemSlug: string,
  fsDelete: (path: string[]) => Promise<void>,
): Promise<CascadeDeleteResult> {
  const tid = rid(tenantId);
  const cascaded: string[] = [];

  const queries = [
    `DELETE FROM subscription WHERE tenantId = $tid;`,
    `DELETE FROM credit_purchase WHERE tenantId = $tid;`,
    `DELETE FROM payment WHERE tenantId = $tid;`,
    `DELETE FROM usage_record WHERE tenantId = $tid;`,
    `DELETE FROM credit_expense WHERE tenantId = $tid;`,
    `DELETE FROM payment_method WHERE tenantId = $tid;`,
    `DELETE FROM connected_app WHERE tenantId = $tid;`,
    `DELETE FROM api_token WHERE tenantId = $tid;`,
    `DELETE FROM tenant_role WHERE tenantId = $tid;`,
    `DELETE FROM tag WHERE tenantId = $tid;`,
    `DELETE FROM location WHERE tenantId = $tid;`,
    `DELETE FROM connected_service WHERE tenantId = $tid;`,
  ];

  await batchedQuery(queries, { tid });

  try {
    await fsDelete([companyId, systemSlug]);
  } catch {
    // File cleanup best-effort
  }

  await forgetActor(tenantId, "");
  await reloadTenant(tenantId);

  cascaded.push(
    "subscription",
    "credit_purchase",
    "payment",
    "usage_record",
    "credit_expense",
    "payment_method",
    "connected_app",
    "api_token",
    "tenant_role",
    "tag",
    "location",
    "connected_service",
    "file",
  );
  return { deleted: true, orphaned: true, cascaded };
}
