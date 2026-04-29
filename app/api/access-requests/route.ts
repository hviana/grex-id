import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { communicationGuard } from "@/server/utils/verification-guard";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import {
  genericCreateSharedRecord,
  genericList,
} from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";

async function postHandler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const body = await req.json();
  const { entityType, entityId, targetTenantId, permissions } = body;

  if (!entityType || !entityId || !targetTenantId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.fields.required",
        },
      },
      { status: 400 },
    );
  }

  const core = Core.getInstance();

  // Validate entityType is in shareable or restricted entities
  const shareableRaw = await core.getSetting("core.shareableEntities");
  const restrictedRaw = await core.getSetting("core.restrictedEntities");

  const shareableEntities: string[] = shareableRaw
    ? JSON.parse(shareableRaw)
    : [];
  const restrictedEntities: string[] = restrictedRaw
    ? JSON.parse(restrictedRaw)
    : [];

  if (
    !shareableEntities.includes(entityType) &&
    !restrictedEntities.includes(entityType)
  ) {
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

  // ── Restricted entities: direct shared_record creation (no human confirmation) ──
  if (restrictedEntities.includes(entityType)) {
    if (
      !permissions ||
      !Array.isArray(permissions) ||
      permissions.length === 0 ||
      !permissions.every((p: string) => ["r", "w", "share"].includes(p))
    ) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.fields.required"],
          },
        },
        { status: 400 },
      );
    }

    const result = await genericCreateSharedRecord({
      recordId: entityId,
      ownerTenantIds: [ctx.tenantContext.tenant.id!],
      accessesTenantIds: [targetTenantId],
      permissions,
    });

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: {
            code: "ERROR",
            message: result.errors?.[0]?.errors?.[0] ?? "common.error.generic",
          },
        },
        { status: 400 },
      );
    }

    return Response.json({ success: true, data: result.data });
  }

  // ── Shareable entities: human confirmation via communicationGuard ──
  const ownerId = ctx.tenantContext.tenant.actorId!;
  const systemSlug = ctx.tenantContext.systemSlug ?? "";
  const system = systemSlug
    ? await core.getSystemBySlug(systemSlug)
    : undefined;
  const settingScope = system ? { systemId: system.id } : undefined;

  // Find admins of the target tenant to send the human-confirmation
  const admins = await genericList({
    table: "tenant",
    select: "actorId",
    extraConditions: [
      "id = $targetTenantId",
      'roleIds CONTAINS (SELECT VALUE id FROM role WHERE name = "admin" LIMIT 1)',
    ],
    extraBindings: { targetTenantId: rid(targetTenantId) },
    limit: 5,
  });

  // For verification, use the requester as the owner
  const guardResult = await communicationGuard({
    ownerId,
    ownerType: "user",
    actionKey: "access.request",
    payload: {
      changes: entityType === "user"
        ? [{
          action: "custom" as const,
          actionKey: "access.request",
          entity: "tenant",
          fields: { actorId: entityId, targetTenantId },
        }]
        : [{
          action: "custom" as const,
          actionKey: "access.request",
          entity: entityType,
          id: entityId,
          fields: { associateTenant: targetTenantId },
        }],
    },
    tenant: {
      tenantIds: [ctx.tenantContext.tenant.id!],
      systemSlug,
    },
  });

  if (!guardResult.allowed) {
    return Response.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "error.rateLimited",
        },
      },
      { status: 429 },
    );
  }

  // Send human-confirmation to target tenant admins
  const baseUrl = (await core.getSetting("app.baseUrl", settingScope)) ??
    "http://localhost:3000";
  const expiryMinutes = Number(
    (await core.getSetting(
      "auth.communication.expiry.minutes",
      settingScope,
    )) || 15,
  );
  const confirmationLink = `${baseUrl}/verify?token=${guardResult.token}`;

  // Resolve entity display name
  let entityLabel = entityId;
  try {
    const entityResult = await genericList({
      table: entityType,
      select: "id, name",
      extraConditions: ["id = $eid"],
      extraBindings: { eid: rid(entityId) },
      limit: 1,
    });
    const entity = entityResult.items[0] as Record<string, unknown> | undefined;
    if (entity?.name) entityLabel = String(entity.name);
  } catch {
    // Keep entityId as label on resolution failure
  }

  // Notify each admin of the target tenant
  for (const admin of admins.items) {
    const adminActorId = String(
      (admin as Record<string, unknown>).actorId ?? "",
    );
    if (!adminActorId) continue;

    await dispatchCommunication({
      recipients: [adminActorId],
      template: "human-confirmation",
      templateData: {
        actionKey: "access.request",
        confirmationLink,
        occurredAt: new Date().toISOString(),
        actorName: entityLabel,
        expiryMinutes: String(expiryMinutes),
        systemSlug,
        resources: [entityType],
      },
    });
  }

  return Response.json({
    success: true,
    data: {
      token: guardResult.token,
      expiresAt: guardResult.expiresAt?.toISOString(),
    },
  });
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 20 },
    roles: ["admin"],
  }),
  async (req, ctx) => postHandler(req, ctx),
);
