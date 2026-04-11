import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { createSystemToken, verifySystemToken } from "@/server/utils/token";
import { standardizeField } from "@/server/utils/field-standardizer";

/**
 * POST /api/auth/oauth/authorize
 *
 * Called by the OAuth authorize page after the user approves access.
 * Creates a connected_app record and an api_token for the requesting app.
 *
 * Body:
 *   clientName    — display name of the external app
 *   permissions   — comma-separated permission list
 *   systemSlug    — slug of the system being accessed
 *   companyId     — company the user is granting access to
 *   redirectOrigin — origin the popup came from (for postMessage validation)
 *   monthlySpendLimit? — optional spend cap in cents
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  let payload: Awaited<ReturnType<typeof verifySystemToken>>;
  try {
    payload = await verifySystemToken(authHeader.slice(7));
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  const body = await req.json();
  const {
    clientName,
    permissions,
    systemSlug,
    companyId,
    redirectOrigin,
    monthlySpendLimit,
  } = body;

  if (!clientName || !systemSlug || !companyId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.oauth.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Resolve systemId from slug
  const sysResult = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug: standardizeField("slug", systemSlug) },
  );
  const systemId = sysResult[0]?.[0]?.id;
  if (!systemId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.notFound" },
      },
      { status: 404 },
    );
  }

  const grantedPermissions: string[] = typeof permissions === "string"
    ? permissions.split(",").map((p: string) => p.trim()).filter(Boolean)
    : Array.isArray(permissions)
    ? permissions
    : [];

  const userId = payload.userId as string;

  // Generate a raw token for the connected app
  const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Hash the token for storage
  const encoder = new TextEncoder();
  const data = encoder.encode(rawToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Single batched query: create connected_app + api_token
  const result = await db.query<[unknown, Record<string, unknown>[]]>(
    `LET $app = CREATE connected_app SET
       name = $clientName,
       companyId = $companyId,
       systemId = $systemId,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit;
     CREATE api_token SET
       userId = $userId,
       companyId = $companyId,
       systemId = $systemId,
       name = $clientName,
       description = $redirectOrigin,
       tokenHash = $tokenHash,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit;
     SELECT * FROM $app[0].id;`,
    {
      clientName,
      companyId: rid(companyId),
      systemId: rid(systemId),
      permissions: grantedPermissions,
      monthlySpendLimit: monthlySpendLimit
        ? Number(monthlySpendLimit)
        : undefined,
      userId: rid(userId),
      redirectOrigin: redirectOrigin ?? "",
      tokenHash,
    },
  );

  const app = (result[2] as Record<string, unknown>[])?.[0];

  return NextResponse.json(
    { success: true, data: { token: rawToken, app } },
    { status: 201 },
  );
}
