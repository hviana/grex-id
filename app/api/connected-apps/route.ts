import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken, hashToken } from "@/server/utils/token";
import type { Tenant } from "@/src/contracts/tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;

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
 * POST — creates a connected_app AND its backing api_token in one batched query.
 * The connected_app is linked to the api_token via apiTokenId.
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

  const rawToken = generateSecureToken();
  const tokenHash = await hashToken(rawToken);
  const jti = crypto.randomUUID();

  // Build tenant
  const tenant: Tenant = {
    systemId: ctx.tenant.systemId,
    companyId: ctx.tenant.companyId,
    systemSlug: ctx.tenant.systemSlug,
    roles: [],
    permissions: permissions ?? [],
  };

  const db = await getDb();
  const result = await db.query<
    [unknown, unknown, Record<string, unknown>[]]
  >(
    `LET $token = CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      tokenHash = $tokenHash,
      jti = $jti,
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
    SELECT * FROM $app[0].id;`,
    {
      userId: rid(ctx.claims?.actorId ?? "0"),
      name,
      companyId: rid(companyId),
      systemId: rid(systemId),
      tenant,
      tokenHash,
      jti,
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
    },
  );

  const app = result[2]?.[0];
  return Response.json(
    {
      success: true,
      data: {
        app,
        token: rawToken, // Shown once
      },
    },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
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
 * DELETE — revokes the linked api_token AND deletes the connected_app
 * in a single batched query (revocation guarantee per §19.12).
 */
async function deleteHandler(req: Request, ctx: RequestContext) {
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

  const db = await getDb();

  // Set revokedAt on the linked api_token and delete the connected_app in one batch
  await db.query(
    `LET $app = (SELECT apiTokenId FROM $id LIMIT 1);
     IF $app[0].apiTokenId != NONE {
       UPDATE $app[0].apiTokenId SET revokedAt = time::now() WHERE revokedAt IS NONE;
     };
     DELETE $id;`,
    { id: rid(id) },
  );

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
