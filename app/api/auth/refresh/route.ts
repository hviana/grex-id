import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "@/server/utils/actor-validity";
import { getUserForRefresh } from "@/server/db/queries/auth";

function withAuthRateLimit() {
  return async (
    req: Request,
    ctx: RequestContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const core = Core.getInstance();
    const rateLimitPerMinute = Number(
      (await core.getSetting("auth.rateLimit.perMinute")) || 5,
    );
    return withRateLimit({
      windowMs: 60_000,
      maxRequests: rateLimitPerMinute,
    })(req, ctx, next);
  };
}

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { systemToken } = body;

  if (!systemToken) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  try {
    const tenant = await verifyTenantToken(systemToken);
    await ensureActorValidityLoaded(tenant.id);

    // Cache-only validity check (§8.11). Refresh extends the lifetime of
    // an already-valid bearer; it is not a recovery path. A user whose id
    // was evicted (logout, role change, tenant removal) must log in again.
    if (!tenant.actorId || !isActorValid(tenant.id, String(tenant.actorId))) {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    // Only user sessions can refresh here — API-token / connected-app JWTs
    // are issued with their final expiry and do not use this endpoint.
    if (tenant.actorType !== "user") {
      return Response.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "auth.error.refreshNotAllowed",
          },
        },
        { status: 403 },
      );
    }

    // Fetch the fields the client needs to re-hydrate its UI state. Roles
    // are preserved from the current tenant — role changes evict the user
    // (§8.11) and would have rejected this refresh.
    const user = await getUserForRefresh(String(tenant.actorId));
    if (!user) {
      return Response.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "auth.error.userNotFound" },
        },
        { status: 401 },
      );
    }

    const newToken = await createTenantToken(
      tenant,
      user.stayLoggedIn ?? false,
    );

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
        user: {
          id: user.id,
          profileId: user.profileId,
          channelIds: user.channelIds ?? [],
          twoFactorEnabled: user.twoFactorEnabled ?? false,
        },
      },
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 401 },
    );
  }
}

export const POST = compose(withAuthRateLimit(), handler);
