import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant";

async function getHandler(_req: Request, ctx: RequestContext) {
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  let query = "SELECT * FROM connected_app";
  const conditions: string[] = [];

  if (companyId && companyId !== "0") {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(companyId);
  }
  if (systemId && systemId !== "0") {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(systemId);
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  return Response.json({ success: true, data: result[0] ?? [] });
}

/**
 * POST — creates a connected_app AND its backing api_token in one batched
 * query, then issues a JWT (§19.10) whose `actorId` is the api_token id.
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

  const db = await getDb();
  const result = await db.query<
    [unknown, unknown, Record<string, unknown>[], ApiToken[]]
  >(
    `LET $token = CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      neverExpires = true,
      frontendUse = false,
      frontendDomains = [];
    LET $app = CREATE connected_app SET
      name = $name,
      companyId = $companyId,
      systemId = $systemId,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      apiTokenId = $token[0].id;
    SELECT * FROM $app[0].id;
    SELECT * FROM $token[0].id;`,
    {
      userId: rid(ctx.claims?.actorId ?? "0"),
      name,
      companyId: rid(companyId),
      systemId: rid(systemId),
      tenant,
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
    },
  );

  const app = result[2]?.[0];
  const createdToken = result[3]?.[0];
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

  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (name !== undefined) {
    sets.push("name = $name");
    bindings.name = name;
  }
  if (permissions !== undefined) {
    sets.push("permissions = $permissions");
    bindings.permissions = permissions;
  }
  if (monthlySpendLimit !== undefined) {
    sets.push("monthlySpendLimit = $monthlySpendLimit");
    bindings.monthlySpendLimit = monthlySpendLimit || undefined;
  }

  if (sets.length === 0) {
    return Response.json({ success: true });
  }

  const result = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );

  return Response.json({ success: true, data: result[0]?.[0] });
}

/**
 * DELETE — revokes the linked api_token AND deletes the connected_app in a
 * single batched query; evicts the api_token id from the tenant's
 * actor-validity partition (§12.8 / §19.12).
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

  // Single batched query (§7.2): read the linked api_token + tenant keys,
  // set `revokedAt` on the api_token, then delete the connected_app.
  const db = await getDb();
  const result = await db.query<
    [
      unknown,
      unknown,
      unknown,
      { apiTokenId: string; companyId: string; systemId: string }[],
    ]
  >(
    `LET $app = (SELECT apiTokenId, companyId, systemId FROM $id LIMIT 1);
     IF $app[0].apiTokenId != NONE {
       UPDATE $app[0].apiTokenId SET revokedAt = time::now() WHERE revokedAt IS NONE;
     };
     DELETE $id;
     RETURN $app;`,
    { id: rid(id) },
  );

  const row = result[3]?.[0];
  const apiTokenId = String(row?.apiTokenId ?? "");
  if (apiTokenId && row?.companyId && row?.systemId) {
    await forgetActor(
      { companyId: String(row.companyId), systemId: String(row.systemId) },
      apiTokenId,
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
