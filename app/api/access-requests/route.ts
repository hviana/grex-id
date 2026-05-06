import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { get } from "@/server/utils/cache";
import { communicationGuard } from "@/server/utils/verification-guard";
import { dispatchCommunication } from "@/server/event-queue/handlers/send-communication";
import { addShare, genericList } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import { parseBody } from "@/server/utils/parse-body";

async function postHandler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { entityType, entityId, targetTenantId, permissions, fields } = body;

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

  // Validate entityType is in shareable or restricted entities
  const shareableRaw = await get(undefined, "setting.core.shareableEntities");
  const restrictedRaw = await get(undefined, "setting.core.restrictedEntities");

  const shareableEntities: string[] = shareableRaw
    ? JSON.parse(String(shareableRaw))
    : [];
  const restrictedEntities: string[] = restrictedRaw
    ? JSON.parse(String(restrictedRaw))
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

    const result = await addShare(
      { table: entityType },
      entityId,
      { id: targetTenantId },
      permissions,
      ctx.tenantContext.tenant,
      fields,
    );

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
  const coreData = await get(undefined, "core-data") as any;
  const system = systemSlug ? coreData?.systemsBySlug?.[systemSlug] : undefined;
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
    extraAccessFields: ["id", "roleIds"],
    allowRawExtraConditions: true,
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
  const baseUrl = (await get(settingScope, "setting.app.baseUrl")) ??
    "http://localhost:3000";
  const expiryMinutes = Number(
    (await get(
      settingScope,
      "setting.auth.communication.expiry.minutes",
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
      extraAccessFields: ["id"],
      allowRawExtraConditions: true,
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
    accesses: [{ roles: ["admin"] }],
  }),
  async (req, ctx) => postHandler(req, ctx),
);
