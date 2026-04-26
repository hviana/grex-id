import { getCache, registerCache } from "@/server/utils/cache";
import { createTenantToken } from "@/server/utils/token";
import { getSystemTenant } from "@/server/utils/tenant";
import type { TenantClaims } from "@/src/contracts/tenant";

registerCache<string>("core", "anonymous-jwt", async () => {
  const tenant = await getSystemTenant();

  const claims: TenantClaims = {
    id: tenant.id,
    systemId: tenant.systemId,
    companyId: tenant.companyId,
    systemSlug: "core",
    roles: ["anonymous"],
    actorType: "api_token",
    actorId: "api_token:anonymous",
    exchangeable: false,
  };

  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  return createTenantToken(claims, false, expiresAt);
});

export async function GET(): Promise<Response> {
  try {
    const jwt = await getCache<string>("core", "anonymous-jwt");
    return Response.json({ success: true, data: { token: jwt } });
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
