import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { deriveActorType, get, limitsMerger } from "@/server/utils/cache";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "@/server/utils/actor-validity";
import { genericGetById } from "@/server/db/queries/generics";

async function handler(req: Request, _ctx: RequestContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }
  const { systemToken } = body as { systemToken?: string };

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

    const actorType = deriveActorType(actorId);

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
    }>(
      {
        table: "user",
        cascade: [
          { table: "profile", sourceField: "profileId" },
          { table: "entity_channel", sourceField: "channelIds", isArray: true },
        ],
        skipAccessCheck: true,
      },
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

    const rawRoles = await get(tenant, "roles");
    const roles = Array.isArray((rawRoles as any)?.names)
      ? (rawRoles as any).names as string[]
      : Array.isArray(rawRoles)
      ? rawRoles as string[]
      : [];
    const frontendDomains =
      ((await get(tenant, "limits", limitsMerger)) as any)?.frontendDomains ??
        [];

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
          profileId: user._cascade?.profileId ?? null,
          channelIds: user._cascade?.channelIds instanceof Set
            ? [...user._cascade.channelIds]
            : (user._cascade?.channelIds ?? []),
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
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 60 } }),
  handler,
);
