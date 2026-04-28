import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import type { EventChange } from "@/src/contracts/high_level/event-payload";
import {
  findUserByVerifiedChannel,
  findVerificationRequest,
  markVerificationUsed,
  resolveUserMembership,
} from "@/server/db/queries/auth";
import {
  associateLeadWithTenant,
  syncLeadChannels,
} from "@/server/db/queries/leads";
import {
  applyEventPayload,
  genericAssociate,
  genericCount,
} from "@/server/db/queries/generics";
import { getDb, rid } from "@/server/db/connection";
import { runLifecycleHooks } from "@/server/module-registry";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";

/** Handlers for "custom" EventChange entries that cannot be expressed as
 *  single-row genericCreate / genericUpdate / genericDelete. */
async function handleCustomChange(
  c: EventChange,
  ownerId: string,
): Promise<void> {
  const entity = c.entity;

  // ── user ──────────────────────────────────────────────────────────
  if (entity === "user") {
    if (c.fields._promoteTwoFactor) {
      // Copy pendingTwoFactorSecret → twoFactorSecret
      const db = await getDb();
      await db.query(
        `UPDATE user SET
           twoFactorEnabled = true,
           twoFactorSecret = pendingTwoFactorSecret,
           pendingTwoFactorSecret = NONE
         WHERE id = $id`,
        { id: rid(ownerId) },
      );
      return;
    }
  }

  // ── lead ──────────────────────────────────────────────────────────
  if (entity === "lead") {
    const leadId = c.id!;
    const fields = c.fields as Record<string, unknown>;

    if (Array.isArray(fields.syncChannels)) {
      await syncLeadChannels(
        leadId,
        fields.syncChannels as { type: string; value: string }[],
      );
    }

    if (Array.isArray(fields.associateTenants)) {
      for (const tenantId of fields.associateTenants as string[]) {
        const already = (await genericCount({
          table: "lead",
          tenant: { id: tenantId },
          extraConditions: ["id = $leadId"],
          extraBindings: { leadId: rid(leadId) },
        })) > 0;
        if (!already) {
          await associateLeadWithTenant({ leadId, tenantId });
        }
      }
    }
    return;
  }

  // ── tenant (access.request for user sharing) ──────────────────────
  if (entity === "tenant") {
    const fields = c.fields as { actorId?: string; targetTenantId?: string };
    const targetTenantId = fields.targetTenantId;
    const actorId = fields.actorId;

    if (!targetTenantId || !actorId) return;

    const db = await getDb();
    const tenantRows = await db.query<
      [{ companyId?: string; systemId?: string }[]]
    >(
      `SELECT companyId, systemId FROM tenant WHERE id = $tid LIMIT 1`,
      { tid: rid(targetTenantId) },
    );
    const tenantRow = tenantRows[0]?.[0];
    const companyId = String(tenantRow?.companyId ?? "");
    const systemId = String(tenantRow?.systemId ?? "");

    if (!companyId || !systemId) return;

    const resolveRoles =
      `(SELECT VALUE id FROM role WHERE name = "admin" AND tenantIds CONTAINS (SELECT id FROM tenant WHERE !actorId AND !companyId AND systemId = ${rid(systemId)} LIMIT 1) LIMIT 1)`;
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
        userId: rid(actorId),
        companyId: rid(companyId),
        systemId: rid(systemId),
      },
    );

    await forgetActor({ id: targetTenantId, actorId });
    return;
  }

  // ── generic associate (access.request for other shareable entities)
  if (typeof c.fields.associateTenant === "string") {
    await genericAssociate(entity, c.id!, {
      id: c.fields.associateTenant as string,
    });
    return;
  }
}

async function handler(req: Request, _ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { token } = body;

  if (!token) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request) {
    return Response.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return Response.json(
      {
        success: false,
        error: { code: "ALREADY_USED", message: "auth.error.linkUsed" },
      },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return Response.json(
      {
        success: false,
        error: { code: "EXPIRED", message: "auth.error.linkExpired" },
      },
      { status: 400 },
    );
  }

  const actionKey = request.actionKey;
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const ownerId = request.ownerId;

  // ── loginFallback — no DB changes, issues a new token ──────────────
  if (actionKey === "auth.action.loginFallback") {
    const identifier = typeof payload?.identifier === "string"
      ? (payload.identifier as string)
      : "";
    const stayLoggedIn = typeof payload?.stayLoggedIn === "boolean"
      ? (payload.stayLoggedIn as boolean)
      : false;

    const user = identifier
      ? await findUserByVerifiedChannel(identifier)
      : null;
    if (user && String(user.id) === String(ownerId)) {
      await markVerificationUsed(request.id);

      const mem = await resolveUserMembership(String(user.id));

      if (!mem) {
        return Response.json(
          {
            success: false,
            error: {
              code: "NO_MEMBERSHIP",
              message: "auth.error.noMembership",
            },
          },
          { status: 403 },
        );
      }

      const tenant = {
        id: mem.tenantId,
        systemId: mem.systemId,
        companyId: mem.companyId,
        actorId: String(user.id),
      };

      const systemToken = await createTenantToken(tenant, stayLoggedIn);
      await rememberActor({ id: mem.tenantId, actorId: String(user.id) });

      return Response.json({
        success: true,
        data: {
          message: "auth.verify.success",
          actionKey,
          systemToken,
          tenant,
          roles: mem.roles,
          actorType: "user" as const,
          exchangeable: true,
          frontendDomains: [] as string[],
          user: {
            id: user.id,
            profileId: user.profileId,
            channelIds: user.channelIds,
            twoFactorEnabled: user.twoFactorEnabled ?? false,
          },
        },
      });
    }
  }

  // ── All other actions — apply payload.changes via generics ─────────
  const changes = (payload.changes ?? []) as EventChange[];

  if (changes.length > 0) {
    const result = await applyEventPayload(
      changes,
      (c: EventChange) => handleCustomChange(c, ownerId),
    );
    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: result.errors?.[0]?.message ?? "common.error.generic",
          },
        },
        { status: 400 },
      );
    }
  }

  // ── Non-DB side effects ────────────────────────────────────────────
  if (actionKey === "auth.action.leadUpdate") {
    const hooks = payload.hooks as Record<string, unknown> | undefined;
    if (hooks?.faceDescriptor && Array.isArray(hooks.faceDescriptor) && hooks.faceDescriptor.length > 0) {
      await runLifecycleHooks("lead:verify", {
        leadId: ownerId,
        systemSlug: hooks.systemSlug as string | undefined,
        systemId: hooks.systemId as string | undefined,
        faceDescriptor: hooks.faceDescriptor as number[],
      });
    }
  }

  if (actionKey === "auth.action.twoFactorDisable") {
    // Also clear the secret field (already disabled via changes, but
    // twoFactorSecret must be set to NONE as well).
    const db = await getDb();
    await db.query(
      `UPDATE user SET twoFactorSecret = NONE WHERE id = $id`,
      { id: rid(ownerId) },
    );
  }

  await markVerificationUsed(request.id);

  return Response.json({
    success: true,
    data: { message: "auth.verify.success", actionKey },
  });
}

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 10 } }),
  handler,
);
