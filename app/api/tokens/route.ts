import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const companyId = ctx.tenant.companyId;

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  let query =
    `SELECT id, name, description, permissions, monthlySpendLimit, maxOperationCount,
            neverExpires, expiresAt, frontendUse, frontendDomains, createdAt
     FROM api_token WHERE revokedAt IS NONE`;
  const conditions: string[] = [];

  if (userId) {
    conditions.push("userId = $userId");
    bindings.userId = rid(userId);
  }
  if (companyId && companyId !== "0") {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(companyId);
  }

  if (conditions.length) query += " AND " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  return Response.json({ success: true, data: result[0] ?? [] });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const {
    name,
    description,
    userId,
    companyId,
    systemId,
    permissions,
    monthlySpendLimit,
    maxOperationCount,
    neverExpires,
    expiresAt,
    frontendUse,
    frontendDomains,
  } = body;

  if (!name || !userId || !companyId || !systemId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  if (neverExpires && expiresAt) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.expiryExclusive",
        },
      },
      { status: 400 },
    );
  }

  const useFrontend = frontendUse === true;
  const domains: string[] = frontendDomains ?? [];
  if (useFrontend && domains.length === 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.frontendDomainsRequired",
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
  const result = await db.query<[ApiToken[]]>(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      description = $description,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      maxOperationCount = $maxOperationCount,
      neverExpires = $neverExpires,
      expiresAt = $expiresAt,
      frontendUse = $frontendUse,
      frontendDomains = $frontendDomains`,
    {
      userId: rid(userId),
      companyId: rid(companyId),
      systemId: rid(systemId),
      tenant,
      name,
      description: description ?? undefined,
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
      maxOperationCount: maxOperationCount ?? undefined,
      neverExpires: neverExpires === true,
      expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59.999Z") : undefined,
      frontendUse: useFrontend,
      frontendDomains: domains,
    },
  );

  const createdToken = result[0]?.[0];
  if (!createdToken) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  // Issue the JWT bearer for this api_token. The actor id is the row id
  // (§12.8); exp comes from expiresAt or a far-future date for
  // never-expires tokens.
  const far = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const exp = createdToken.neverExpires
    ? far
    : createdToken.expiresAt
    ? new Date(createdToken.expiresAt)
    : far;

  const jwt = await createTenantToken(
    {
      ...tenant,
      actorType: "api_token",
      actorId: String(createdToken.id),
      exchangeable: false,
      frontendUse: createdToken.frontendUse,
      frontendDomains: createdToken.frontendDomains ?? [],
    },
    false,
    exp,
  );

  await rememberActor(tenant, String(createdToken.id));

  return Response.json(
    { success: true, data: { token: jwt } },
    { status: 201 },
  );
}

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

  // Resolve tenant + revoke in a single batched query (§7.2).
  const db = await getDb();
  const result = await db.query<
    [{ companyId: string; systemId: string }[], unknown]
  >(
    `SELECT companyId, systemId FROM $id LIMIT 1;
     UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE;`,
    { id: rid(id) },
  );

  const row = result[0]?.[0];
  if (row?.companyId && row?.systemId) {
    await forgetActor(
      { companyId: String(row.companyId), systemId: String(row.systemId) },
      id,
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

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
