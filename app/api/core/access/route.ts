import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import {
  genericAssociate,
  genericDeleteSharedRecords,
  genericDisassociate,
  genericList,
  genericListSharedRecords,
} from "@/server/db/queries/generics";
import { getDb, rid } from "@/server/db/connection";

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
  const body = await req.json();
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

    const result = await genericDeleteSharedRecords(shareIds);
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
      // For users, delete the user-access tenant rows directly
      const db = await getDb();
      const resolvedIds = tenantIds.map((id: string) => rid(id));
      await db.query(
        `DELETE FROM tenant WHERE id IN $ids AND actorId = $actorId`,
        { ids: resolvedIds, actorId: rid(entityId) },
      );
      return Response.json({ success: true });
    }

    // Generic: disassociate from entity's own tenantIds
    for (const tenantId of tenantIds) {
      await genericDisassociate(entityType, entityId, { id: tenantId });
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
