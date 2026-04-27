import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "@/server/utils/actor-validity";
import { genericGetById } from "@/server/db/queries/generics";

async function handler(req: Request, _ctx: RequestContext): Promise<Response> {
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
    const { tenant } = await verifyTenantToken(systemToken);
    await ensureActorValidityLoaded(tenant);

    const actorId = tenant.actorId;
    if (!actorId || !isActorValid(tenant)) {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    const core = Core.getInstance();
    const actorType = Core.deriveActorType(actorId);

    // Only user sessions can refresh
    if (actorType !== "user") {
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

    const user = await genericGetById<{
      id: string;
      stayLoggedIn: boolean;
      twoFactorEnabled: boolean;
      profileId?: unknown;
      channelIds?: unknown[];
    }>(
      { table: "user", fetch: "profileId, channelIds" },
      String(actorId),
    );
    if (!user) {
      return Response.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "auth.error.userNotFound" },
        },
        { status: 401 },
      );
    }

    const roles = await core.getTenantRoles(tenant);
    const frontendDomains = await core.getFrontendDomains(tenant);

    const newToken = await createTenantToken(
      tenant,
      user.stayLoggedIn ?? false,
    );

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
        tenant,
        roles,
        actorType: "user" as const,
        exchangeable: true,
        frontendDomains,
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

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }),
  handler,
);
