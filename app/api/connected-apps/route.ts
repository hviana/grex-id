import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import type { Tenant } from "@/src/contracts/tenant";
import {
  createConnectedAppWithToken,
  revokeConnectedApp,
} from "@/server/db/queries/connected-apps";
import {
  genericList,
  genericUpdate,
  type TenantIsolation,
} from "@/server/db/queries/generics";
import type { ConnectedApp } from "@/src/contracts/connected-app";

async function getHandler(_req: Request, ctx: RequestContext) {
  const ensureTenant: TenantIsolation = {};
  if (ctx.tenant.companyId && ctx.tenant.companyId !== "0") {
    ensureTenant.companyId = ctx.tenant.companyId;
  }
  if (ctx.tenant.systemId && ctx.tenant.systemId !== "0") {
    ensureTenant.systemId = ctx.tenant.systemId;
  }

  const result = await genericList<ConnectedApp>(
    {
      table: "connected_app",
      limit: 50,
    },
    {
      limit: 50,
      ensureTenant: Object.keys(ensureTenant).length ? ensureTenant : undefined,
    },
  );
  return Response.json({ success: true, data: result.data });
}

/**
 * POST — creates a connected_app AND its backing api_token in one batched
 * query, then issues a JWT (§8.1) whose `actorId` is the api_token id.
 */
async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { name, companyId, systemId, permissions, monthlySpendLimit } = body;

  if (!name || !companyId || !systemId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.connectedApp.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const tenant: Tenant = {
    systemId: ctx.tenant.systemId,
    companyId: ctx.tenant.companyId,
    systemSlug: ctx.tenant.systemSlug,
    roles: [],
    permissions: permissions ?? [],
  };

  const { app, token: createdToken } = await createConnectedAppWithToken({
    userId: ctx.claims?.actorId ?? "0",
    name,
    companyId,
    systemId,
    tenant,
    permissions: permissions ?? [],
    monthlySpendLimit,
  });

  if (!createdToken) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const jwt = await createTenantToken(
    {
      ...tenant,
      actorType: "connected_app",
      actorId: String(createdToken.id),
      exchangeable: false,
      frontendUse: false,
      frontendDomains: [],
    },
    false,
    farFuture,
  );

  await rememberActor(tenant, String(createdToken.id));

  return Response.json(
    { success: true, data: { app, token: jwt } },
    { status: 201 },
  );
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id, name, permissions, monthlySpendLimit } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (permissions !== undefined) data.permissions = permissions;
  if (monthlySpendLimit !== undefined) {
    data.monthlySpendLimit = monthlySpendLimit || undefined;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ success: true });
  }

  const result = await genericUpdate<ConnectedApp>(
    { table: "connected_app" },
    id,
    data,
  );

  if (!result.success || !result.data) {
    return Response.json({ success: true });
  }

  return Response.json({ success: true, data: result.data });
}

/**
 * DELETE — revokes the linked api_token AND deletes the connected_app in a
 * single batched query; evicts the api_token id from the tenant's
 * actor-validity partition (§8.11 / §8.11).
 */
async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const revoked = await revokeConnectedApp(id);

  if (revoked) {
    await forgetActor(
      { companyId: revoked.companyId, systemId: revoked.systemId },
      revoked.apiTokenId,
    );
  }

  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
