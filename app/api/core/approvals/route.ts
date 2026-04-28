import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import {
  applyPasswordHash,
  disableTwoFactor,
  findUserByVerifiedChannel,
  findVerificationRequest,
  markVerificationUsed,
  promoteTwoFactorSecret,
  resolveUserMembership,
} from "@/server/db/queries/auth";
import { verifyChannels } from "@/server/db/queries/entity-channels";
import {
  associateLeadWithTenant,
  syncLeadChannels,
  updateLead,
} from "@/server/db/queries/leads";
import {
  genericAssociate,
  genericCount,
  genericCreateSharedRecord,
} from "@/server/db/queries/generics";
import { getDb, rid } from "@/server/db/connection";
import { runLifecycleHooks } from "@/server/module-registry";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";

interface LeadUpdatePayload {
  name?: string;
  profile?: {
    name?: string;
    avatarUri?: string;
    dateOfBirth?: string;
  };
  tags?: string[];
  tenantIds?: string[];
  systemId?: string;
  systemSlug?: string;
  faceDescriptor?: number[];
  channels?: { type: string; value: string }[];
}

function parseLeadUpdatePayload(
  payload: Record<string, unknown> | null | undefined,
): LeadUpdatePayload {
  if (!payload) return {};
  const rawProfile = payload.profile;
  const profile = rawProfile && typeof rawProfile === "object"
    ? (() => {
      const p = rawProfile as Record<string, unknown>;
      return {
        name: typeof p.name === "string" ? p.name : undefined,
        avatarUri: typeof p.avatarUri === "string" ? p.avatarUri : undefined,
        dateOfBirth: typeof p.dateOfBirth === "string"
          ? p.dateOfBirth
          : undefined,
      };
    })()
    : undefined;

  const channels = Array.isArray(payload.channels)
    ? payload.channels.filter(
      (c): c is { type: string; value: string } =>
        !!c && typeof c === "object" &&
        typeof (c as { type?: unknown }).type === "string" &&
        typeof (c as { value?: unknown }).value === "string",
    )
    : undefined;

  return {
    name: typeof payload.name === "string" ? payload.name : undefined,
    profile,
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    tenantIds: Array.isArray(payload.tenantIds)
      ? payload.tenantIds.filter(
        (tenantId): tenantId is string => typeof tenantId === "string",
      )
      : undefined,
    systemId: typeof payload.systemId === "string"
      ? payload.systemId
      : undefined,
    systemSlug: typeof payload.systemSlug === "string"
      ? payload.systemSlug
      : undefined,
    faceDescriptor: Array.isArray(payload.faceDescriptor)
      ? payload.faceDescriptor.filter(
        (value): value is number => typeof value === "number",
      )
      : undefined,
    channels,
  };
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
  const payload = request.payload as Record<string, unknown> | null;

  if (
    actionKey === "auth.action.register" ||
    actionKey === "auth.action.entityChannelAdd"
  ) {
    const ids = Array.isArray(payload?.channelIds)
      ? (payload!.channelIds as string[]).filter((id) => typeof id === "string")
      : [];
    if (ids.length > 0) {
      await verifyChannels(ids);
    }
  } else if (actionKey === "auth.action.leadRegister") {
    const ids = Array.isArray(payload?.channelIds)
      ? (payload!.channelIds as string[]).filter((id) => typeof id === "string")
      : [];
    if (ids.length > 0) {
      await verifyChannels(ids);
    }
  } else if (actionKey === "auth.action.passwordChange") {
    const hash = typeof payload?.newPasswordHash === "string"
      ? payload!.newPasswordHash
      : "";
    if (hash) {
      await applyPasswordHash(request.ownerId, hash);
    }
  } else if (actionKey === "auth.action.twoFactorEnable") {
    await promoteTwoFactorSecret(request.ownerId);
  } else if (actionKey === "auth.action.twoFactorDisable") {
    await disableTwoFactor(request.ownerId);
  } else if (actionKey === "auth.action.loginFallback") {
    const identifier = typeof payload?.identifier === "string"
      ? (payload!.identifier as string)
      : "";
    const stayLoggedIn = typeof payload?.stayLoggedIn === "boolean"
      ? (payload!.stayLoggedIn as boolean)
      : false;

    const user = identifier
      ? await findUserByVerifiedChannel(identifier)
      : null;
    if (user && String(user.id) === String(request.ownerId)) {
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
  } else if (actionKey === "auth.action.leadUpdate") {
    const leadPayload = parseLeadUpdatePayload(payload);
    const leadId = request.ownerId;

    await updateLead(leadId, {
      name: leadPayload.name,
      profile: leadPayload.profile,
      tags: leadPayload.tags,
    });

    if (leadPayload.channels && leadPayload.channels.length > 0) {
      await syncLeadChannels(leadId, leadPayload.channels);
    }

    if (leadPayload.tenantIds?.length) {
      for (const tenantId of leadPayload.tenantIds) {
        const alreadyAssociated = (await genericCount({
          table: "lead",
          tenant: { id: tenantId },
          extraConditions: ["id = $leadId"],
          extraBindings: { leadId: rid(leadId) },
        })) > 0;
        if (!alreadyAssociated) {
          await associateLeadWithTenant({ leadId, tenantId });
        }
      }
    }

    if (leadPayload.faceDescriptor && leadPayload.faceDescriptor.length > 0) {
      await runLifecycleHooks("lead:verify", {
        leadId,
        systemSlug: leadPayload.systemSlug,
        systemId: leadPayload.systemId,
        faceDescriptor: leadPayload.faceDescriptor,
      });
    }
  } else if (actionKey === "access.request") {
    const entityType = String(payload?.entityType ?? "");
    const entityId = String(payload?.entityId ?? "");
    const targetTenantId = String(payload?.targetTenantId ?? "");
    const permission = payload?.permission as string | undefined;
    const requesterTenantId = payload?.requesterTenantId as string | undefined;

    if (!entityType || !entityId || !targetTenantId) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "validation.payload.invalid" },
        },
        { status: 400 },
      );
    }

    const shareableRaw = await Core.getInstance().getSetting(
      "core.shareableEntities",
    );
    const restrictedRaw = await Core.getInstance().getSetting(
      "core.restrictedEntities",
    );

    const shareableEntities: string[] = shareableRaw
      ? JSON.parse(shareableRaw)
      : [];
    const restrictedEntities: string[] = restrictedRaw
      ? JSON.parse(restrictedRaw)
      : [];

    if (restrictedEntities.includes(entityType)) {
      if (!permission || !["r", "w", "rw", "share"].includes(permission)) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "validation.permission.required",
            },
          },
          { status: 400 },
        );
      }

      const ownerTenantId = requesterTenantId ?? "";

      await genericCreateSharedRecord({
        recordId: entityId,
        ownerTenantIds: ownerTenantId ? [ownerTenantId] : [],
        accessesTenantIds: [targetTenantId],
        permissions: permission as "r" | "w" | "rw" | "share",
      });
    } else if (shareableEntities.includes(entityType)) {
      if (entityType === "user") {
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

        if (!companyId || !systemId) {
          return Response.json(
            {
              success: false,
              error: {
                code: "VALIDATION",
                message: "validation.tenant.invalid",
              },
            },
            { status: 400 },
          );
        }

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
            userId: rid(entityId),
            companyId: rid(companyId),
            systemId: rid(systemId),
          },
        );

        await forgetActor({
          id: targetTenantId,
          actorId: entityId,
        });
      } else {
        await genericAssociate(entityType, entityId, {
          id: targetTenantId,
        });
      }
    } else {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["access.error.invalidEntityType"],
          },
        },
        { status: 400 },
      );
    }
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
