import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import Core from "@/server/utils/Core";
import {
  editShare,
  genericDeleteSharedRecords,
  genericDisassociate,
  genericList,
  genericListSharedRecords,
} from "@/server/db/queries/generics";
import { deleteUserTenantAccess } from "@/server/db/queries/access";
import { rid } from "@/server/db/connection";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");

  if (!entityType || !entityId) {
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
  const shareableRaw = await core.getSetting("core.shareableEntities");
  const restrictedRaw = await core.getSetting("core.restrictedEntities");

  const shareableEntities: string[] = shareableRaw
    ? JSON.parse(shareableRaw)
    : [];
  const restrictedEntities: string[] = restrictedRaw
    ? JSON.parse(restrictedRaw)
    : [];

  if (restrictedEntities.includes(entityType)) {
    // List shared_record entries for this entity
    const result = await genericListSharedRecords({
      recordId: entityId,
    });

    return Response.json({ success: true, ...result });
  }

  if (shareableEntities.includes(entityType)) {
    // For shareable entities, list tenant associations
    // The specific resolution depends on the entity type
    if (entityType === "user") {
      // List tenant rows where this user is the actor
      const result = await genericList({
        table: "tenant",
        select: "id, companyId, systemId, roleIds, groupIds",
        extraConditions: [
          "actorId = $actorId",
          "companyId != NONE",
          "systemId != NONE",
        ],
        extraBindings: { actorId: rid(entityId) },
        limit: 100,
      });

      return Response.json({ success: true, ...result });
    }

    // Generic: entities that have tenantIds
    const result = await genericList({
      table: entityType,
      select: "id, tenantIds",
      extraConditions: ["id = $eid"],
      extraBindings: { eid: rid(entityId) },
      limit: 1,
    });

    return Response.json({ success: true, ...result });
  }

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

async function deleteHandler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { entityType, entityId, shareIds, tenantIds } = body;

  if (!entityType || !entityId) {
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
  const shareableRaw = await core.getSetting("core.shareableEntities");
  const restrictedRaw = await core.getSetting("core.restrictedEntities");

  const shareableEntities: string[] = shareableRaw
    ? JSON.parse(shareableRaw)
    : [];
  const restrictedEntities: string[] = restrictedRaw
    ? JSON.parse(restrictedRaw)
    : [];

  if (restrictedEntities.includes(entityType)) {
    // Delete shared_record entries
    if (!shareIds || !Array.isArray(shareIds) || shareIds.length === 0) {
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

    const result = await genericDeleteSharedRecords(
      shareIds,
      ctx.tenantContext.tenant,
    );
    return Response.json(result);
  }

  if (shareableEntities.includes(entityType)) {
    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
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

    if (entityType === "user") {
      await deleteUserTenantAccess(entityId, tenantIds);
      return Response.json({ success: true });
    }

    // Generic: disassociate from entity's own tenantIds
    for (const tenantId of tenantIds) {
      await genericDisassociate(
        { table: entityType },
        entityId,
        { id: tenantId },
      );
    }
    return Response.json({ success: true });
  }

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

async function putHandler(
  req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { shareId, permissions } = body;

  if (!shareId || !permissions || !Array.isArray(permissions)) {
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

  const result = await editShare(
    shareId,
    { permissions },
    ctx.tenantContext.tenant,
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

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["admin"],
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 30 },
    roles: ["admin"],
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 30 },
    roles: ["admin"],
  }),
  async (req, ctx) => putHandler(req, ctx),
);
