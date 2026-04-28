import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import type { DBChangeRequest } from "@/src/contracts/high_level/event-payload";
import {
  findUserByVerifiedChannel,
  findVerificationRequest,
  markVerificationUsed,
  resolveUserMembership,
} from "@/server/db/queries/auth";
import { applyEventPayload } from "@/server/db/queries/payloads";
import { runLifecycleHooks } from "@/server/module-registry";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";

async function handler(req: Request, _ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { token } = body;

  if (!token) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request) {
    return Response.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return Response.json(
      {
        success: false,
        error: { code: "ALREADY_USED", message: "auth.error.linkUsed" },
      },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return Response.json(
      {
        success: false,
        error: { code: "EXPIRED", message: "auth.error.linkExpired" },
      },
      { status: 400 },
    );
  }

  const actionKey = request.actionKey;
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const ownerId = request.ownerId;

  // ── loginFallback — no DB changes, issues a new token ──────────────
  if (actionKey === "auth.action.loginFallback") {
    const identifier = typeof payload?.identifier === "string"
      ? (payload.identifier as string)
      : "";
    const stayLoggedIn = typeof payload?.stayLoggedIn === "boolean"
      ? (payload.stayLoggedIn as boolean)
      : false;

    const user = identifier
      ? await findUserByVerifiedChannel(identifier)
      : null;
    if (user && String(user.id) === String(ownerId)) {
      await markVerificationUsed(request.id);

      const mem = await resolveUserMembership(String(user.id));

      if (!mem) {
        return Response.json(
          {
            success: false,
            error: {
              code: "NO_MEMBERSHIP",
              message: "auth.error.noMembership",
            },
          },
          { status: 403 },
        );
      }

      const tenant = {
        id: mem.tenantId,
        systemId: mem.systemId,
        companyId: mem.companyId,
        actorId: String(user.id),
      };

      const systemToken = await createTenantToken(tenant, stayLoggedIn);
      await rememberActor({ id: mem.tenantId, actorId: String(user.id) });

      return Response.json({
        success: true,
        data: {
          message: "auth.verify.success",
          actionKey,
          systemToken,
          tenant,
          roles: mem.roles,
          actorType: "user" as const,
          exchangeable: true,
          frontendDomains: [] as string[],
          user: {
            id: user.id,
            profileId: user.profileId,
            channelIds: user.channelIds,
            twoFactorEnabled: user.twoFactorEnabled ?? false,
          },
        },
      });
    }
  }

  // ── All other actions — apply payload.changes via generics ─────────
  const changes = (payload.changes ?? []) as DBChangeRequest[];

  if (changes.length > 0) {
    const result = await applyEventPayload(changes);
    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: result.errors?.[0]?.message ?? "common.error.generic",
          },
        },
        { status: 400 },
      );
    }
  }

  // ── Non-DB side effects ────────────────────────────────────────────
  if (actionKey === "auth.action.leadUpdate") {
    const hooks = payload.hooks as Record<string, unknown> | undefined;
    if (
      hooks?.faceDescriptor && Array.isArray(hooks.faceDescriptor) &&
      hooks.faceDescriptor.length > 0
    ) {
      await runLifecycleHooks("lead:verify", {
        leadId: ownerId,
        systemSlug: hooks.systemSlug as string | undefined,
        systemId: hooks.systemId as string | undefined,
        faceDescriptor: hooks.faceDescriptor as number[],
      });
    }
  }

  await markVerificationUsed(request.id);

  return Response.json({
    success: true,
    data: { message: "auth.verify.success", actionKey },
  });
}

export const POST = compose(
  withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 10 } }),
  handler,
);
