import { getDb } from "@/server/db/connection";
import { createTenantToken } from "@/server/utils/token";
import Core from "@/server/utils/Core";
import type { TenantClaims } from "@/src/contracts/tenant";

export async function GET(): Promise<Response> {
  try {
    const db = await getDb();

    // Load the seeded anonymous API token row — its ID is the universal actor id
    const [rows] = await db.query<
      [{ id: string; companyId: string; systemId: string }[]]
    >(
      `SELECT id, companyId, systemId FROM api_token:anonymous LIMIT 1`,
    );

    const tokenRow = (rows ?? [])[0];
    if (!tokenRow) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    // Resolve the anonymous role for the core system
    const core = Core.getInstance();
    const coreSystem = await core.getSystemBySlug("core");
    if (!coreSystem) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    const roles = await core.getRolesForSystem(String(coreSystem.id));
    const anonymousRole = roles.find((r) => r.name === "anonymous");
    const roleNames = anonymousRole ? [anonymousRole.name] : ["anonymous"];
    const permissions = anonymousRole?.permissions ?? [];

    const claims: TenantClaims = {
      systemId: String(coreSystem.id),
      companyId: String(tokenRow.companyId),
      systemSlug: "core",
      roles: roleNames,
      permissions,
      actorType: "api_token",
      actorId: String(tokenRow.id),
      exchangeable: false,
    };

    // Long-lived token — never expires (matches the seeded api_token)
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const jwt = await createTenantToken(claims, false, expiresAt);

    return Response.json({
      success: true,
      data: { token: jwt },
    });
  } catch (err) {
    console.error("[anonymous-token] error:", err);
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
