import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken, hashToken } from "@/server/utils/token";
import { revokeToken } from "@/server/db/queries/tokens";
import type { Tenant } from "@/src/contracts/tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  let query = `SELECT id, name, description, permissions, monthlySpendLimit,
            neverExpires, expiresAt, frontendUse, frontendDomains,
            jti, createdAt
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

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
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

  // Validate neverExpires XOR expiresAt
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

  // Validate frontendUse requires domains
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

  const rawToken = generateSecureToken();
  const tokenHash = await hashToken(rawToken);
  const jti = crypto.randomUUID();

  // Build tenant from current context
  const tenant: Tenant = {
    systemId: ctx.tenant.systemId,
    companyId: ctx.tenant.companyId,
    systemSlug: ctx.tenant.systemSlug,
    roles: [],
    permissions: permissions ?? [],
  };

  const db = await getDb();
  const result = await db.query(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      description = $description,
      tokenHash = $tokenHash,
      jti = $jti,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
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
      tokenHash,
      jti,
      permissions: permissions ?? [],
      monthlySpendLimit: monthlySpendLimit ?? undefined,
      neverExpires: neverExpires === true,
      expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59.999Z") : undefined,
      frontendUse: useFrontend,
      frontendDomains: domains,
    },
  );

  return Response.json(
    { success: true, data: { token: rawToken } },
    { status: 201 },
  );
}

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

  // Soft-delete: set revokedAt instead of hard-deleting
  await revokeToken(id);
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
