import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";
import type { DBChangeRequest } from "@/src/contracts/high-level/event-payload";
import {
  genericAssociate,
  genericCount,
  genericCreate,
  genericDelete,
  genericUpdate,
} from "./generics";
import { associateLeadWithTenant, syncLeadChannels } from "./leads";
import { forgetActor } from "../../utils/actor-validity";

assertServerOnly("db-changes");

// ---------------------------------------------------------------------------
// Custom dispatcher — complex operations keyed by actionKey + entity + fields
// ---------------------------------------------------------------------------

async function handleCustom(c: DBChangeRequest): Promise<void> {
  const fields = c.fields as Record<string, unknown>;

  // ── twoFactorEnable: promote pendingTwoFactorSecret → twoFactorSecret ──
  if (c.actionKey === "auth.action.twoFactorEnable") {
    const db = await getDb();
    await db.query(
      `UPDATE user SET
         twoFactorEnabled = true,
         twoFactorSecret = pendingTwoFactorSecret,
         pendingTwoFactorSecret = NONE
       WHERE id = $id`,
      { id: rid(c.id!) },
    );
    return;
  }

  // ── leadUpdate: channel sync + tenant association ───────────────────
  if (c.actionKey === "auth.action.leadUpdate") {
    if (Array.isArray(fields.syncChannels)) {
      await syncLeadChannels(
        c.id!,
        fields.syncChannels as { type: string; value: string }[],
      );
    }
    if (Array.isArray(fields.associateTenants)) {
      for (const tenantId of fields.associateTenants as string[]) {
        const already = (await genericCount({
          table: "lead",
          tenant: { id: tenantId },
          extraConditions: ["id = $leadId"],
          extraBindings: { leadId: rid(c.id!) },
        })) > 0;
        if (!already) {
          await associateLeadWithTenant({ leadId: c.id!, tenantId });
        }
      }
    }
    return;
  }

  // ── access.request: tenant creation (user sharing) ──────────────────
  if (c.actionKey === "access.request" && c.entity === "tenant") {
    const f = fields as { actorId?: string; targetTenantId?: string };
    if (!f.targetTenantId || !f.actorId) return;

    const db = await getDb();
    const rows = await db.query<[{ companyId?: string; systemId?: string }[]]>(
      `SELECT companyId, systemId FROM tenant WHERE id = $tid LIMIT 1`,
      { tid: rid(f.targetTenantId) },
    );
    const row = rows[0]?.[0];
    const companyId = String(row?.companyId ?? "");
    const systemId = String(row?.systemId ?? "");
    if (!companyId || !systemId) return;

    const resolveRoles =
      `(SELECT VALUE id FROM role WHERE name = "admin" AND tenantIds CONTAINS (SELECT id FROM tenant WHERE !actorId AND !companyId AND systemId = ${
        rid(systemId)
      } LIMIT 1) LIMIT 1)`;
    await db.query(
      `LET $existing = (SELECT id FROM tenant WHERE actorId = $userId AND companyId = $companyId AND systemId = $systemId LIMIT 1);
       IF array::len($existing) = 0 {
         CREATE tenant SET
           actorId = $userId,
           companyId = $companyId,
           systemId = $systemId,
           roleIds = ${resolveRoles};
       };`,
      {
        userId: rid(f.actorId),
        companyId: rid(companyId),
        systemId: rid(systemId),
      },
    );

    await forgetActor({ id: f.targetTenantId, actorId: f.actorId });
    return;
  }

  // ── access.request: generic associate (other shareable entities) ────
  if (
    c.actionKey === "access.request" &&
    typeof fields.associateTenant === "string"
  ) {
    await genericAssociate(
      { table: c.entity },
      c.id!,
      { id: fields.associateTenant as string },
    );
    return;
  }
}

// ---------------------------------------------------------------------------
// apply — replay DBChangeRequest[] from a verification payload
// ---------------------------------------------------------------------------
//
// Iterates over DBChangeRequest entries.  "create" / "update" / "delete" are
// dispatched to genericCreate / genericUpdate / genericDelete (with empty
// fieldSpecs — fields are already DB-ready).  "custom" entries are handled
// internally via actionKey-based dispatch.

export async function apply(
  changes: DBChangeRequest[],
): Promise<
  { success: boolean; errors?: { changeIndex: number; message: string }[] }
> {
  const errors: { changeIndex: number; message: string }[] = [];

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    try {
      switch (c.action) {
        case "create": {
          const r = await genericCreate<Record<string, unknown>>(
            { table: c.entity, fields: [] },
            c.fields,
          );
          if (!r.success) {
            errors.push({
              changeIndex: i,
              message: `create ${c.entity} failed`,
            });
          }
          break;
        }
        case "update": {
          if (!c.id) {
            errors.push({ changeIndex: i, message: "id required for update" });
            continue;
          }
          const r = await genericUpdate<Record<string, unknown>>(
            { table: c.entity, fields: [] },
            c.id,
            c.fields,
          );
          if (!r.success) {
            errors.push({
              changeIndex: i,
              message: `update ${c.entity} failed`,
            });
          }
          break;
        }
        case "delete": {
          if (!c.id) {
            errors.push({ changeIndex: i, message: "id required for delete" });
            continue;
          }
          const r = await genericDelete(
            { table: c.entity, fields: [] },
            c.id,
          );
          if (!r.success) {
            errors.push({
              changeIndex: i,
              message: `delete ${c.entity} failed`,
            });
          }
          break;
        }
        case "custom":
          await handleCustom(c);
          break;
      }
    } catch (err) {
      errors.push({ changeIndex: i, message: String(err) });
    }
  }

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
