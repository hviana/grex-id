import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  applyPasswordHash,
  disableTwoFactor,
  findUserByVerifiedChannel,
  findVerificationRequest,
  markVerificationUsed,
  promoteTwoFactorSecret,
  resolveUserMembership,
} from "@/server/db/queries/auth";
import { verifyChannels } from "@/server/db/queries/entity-channels";
import {
  associateLeadWithTenant,
  syncLeadChannels,
  updateLead,
} from "@/server/db/queries/leads";
import { genericCount } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import { runLifecycleHooks } from "@/server/module-registry";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";

interface LeadUpdatePayload {
  name?: string;
  profile?: {
    name?: string;
    avatarUri?: string;
    dateOfBirth?: string;
  };
  tags?: string[];
  tenantIds?: string[];
  systemId?: string;
  systemSlug?: string;
  faceDescriptor?: number[];
  channels?: { type: string; value: string }[];
}

function parseLeadUpdatePayload(
  payload: Record<string, unknown> | null | undefined,
): LeadUpdatePayload {
  if (!payload) return {};
  const rawProfile = payload.profile;
  const profile = rawProfile && typeof rawProfile === "object"
    ? (() => {
      const p = rawProfile as Record<string, unknown>;
      return {
        name: typeof p.name === "string" ? p.name : undefined,
        avatarUri: typeof p.avatarUri === "string" ? p.avatarUri : undefined,
        dateOfBirth: typeof p.dateOfBirth === "string"
          ? p.dateOfBirth
          : undefined,
      };
    })()
    : undefined;

  const channels = Array.isArray(payload.channels)
    ? payload.channels.filter(
      (c): c is { type: string; value: string } =>
        !!c && typeof c === "object" &&
        typeof (c as { type?: unknown }).type === "string" &&
        typeof (c as { value?: unknown }).value === "string",
    )
    : undefined;

  return {
    name: typeof payload.name === "string" ? payload.name : undefined,
    profile,
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    tenantIds: Array.isArray(payload.tenantIds)
      ? payload.tenantIds.filter(
        (tenantId): tenantId is string => typeof tenantId === "string",
      )
      : undefined,
    systemId: typeof payload.systemId === "string"
      ? payload.systemId
      : undefined,
    systemSlug: typeof payload.systemSlug === "string"
      ? payload.systemSlug
      : undefined,
    faceDescriptor: Array.isArray(payload.faceDescriptor)
      ? payload.faceDescriptor.filter(
        (value): value is number => typeof value === "number",
      )
      : undefined,
    channels,
  };
}

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
  const payload = request.payload as Record<string, unknown> | null;

  // ── Registration / entity-channel confirmation flows ──────
  // Both register and entityChannelAdd actions simply flip the referenced
  // entity_channel ids to verified.
  if (
    actionKey === "auth.action.register" ||
    actionKey === "auth.action.entityChannelAdd"
  ) {
    const ids = Array.isArray(payload?.channelIds)
      ? (payload!.channelIds as string[]).filter((id) => typeof id === "string")
      : [];
    if (ids.length > 0) {
      await verifyChannels(ids);
    }
  } else if (actionKey === "auth.action.leadRegister") {
    // Verify all channels the lead submitted at registration.
    const ids = Array.isArray(payload?.channelIds)
      ? (payload!.channelIds as string[]).filter((id) => typeof id === "string")
      : [];
    if (ids.length > 0) {
      await verifyChannels(ids);
    }
  } else if (actionKey === "auth.action.passwordChange") {
    // Apply the precomputed argon2 hash stored on the request payload (§8.7).
    const hash = typeof payload?.newPasswordHash === "string"
      ? payload!.newPasswordHash
      : "";
    if (hash) {
      await applyPasswordHash(request.ownerId, hash);
    }
  } else if (actionKey === "auth.action.twoFactorEnable") {
    // Promote the user's pendingTwoFactorSecret (set by `setup-totp` and
    // validated by `confirm-totp`) to twoFactorSecret. The secret never
    // travels through the verification_request payload (§5.1 rule 5).
    await promoteTwoFactorSecret(request.ownerId);
  } else if (actionKey === "auth.action.twoFactorDisable") {
    await disableTwoFactor(request.ownerId);
  } else if (actionKey === "auth.action.loginFallback") {
    // Issue a System API Token for the user, bypassing TOTP since the click
    // on a time-bound single-use confirmation link already proved control of
    // a verified channel (§8.8.3).
    const identifier = typeof payload?.identifier === "string"
      ? (payload!.identifier as string)
      : "";
    const stayLoggedIn = typeof payload?.stayLoggedIn === "boolean"
      ? (payload!.stayLoggedIn as boolean)
      : false;

    const user = identifier
      ? await findUserByVerifiedChannel(identifier)
      : null;
    if (user && String(user.id) === String(request.ownerId)) {
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

      const systemToken = await createTenantToken(
        {
          id: mem.tenantId,
          systemId: mem.systemId,
          companyId: mem.companyId,
          systemSlug: mem.systemSlug,
          roles: mem.roles,
          actorType: "user",
          actorId: String(user.id),
          exchangeable: true,
        },
        stayLoggedIn,
      );

      await rememberActor(mem.tenantId, String(user.id));

      return Response.json({
        success: true,
        data: {
          message: "auth.verify.success",
          actionKey,
          systemToken,
          user: {
            id: user.id,
            profileId: user.profileId,
            channelIds: user.channelIds,
            twoFactorEnabled: user.twoFactorEnabled ?? false,
          },
        },
      });
    }
    // If we fall through, markVerificationUsed still runs at the end, but the
    // user object will be missing — the frontend falls back to showing a
    // failure state.
  } else if (actionKey === "auth.action.leadUpdate") {
    const leadPayload = parseLeadUpdatePayload(payload);
    const leadId = request.ownerId;

    await updateLead(leadId, {
      name: leadPayload.name,
      profile: leadPayload.profile,
      tags: leadPayload.tags,
    });

    // Apply any verified channel updates included in the payload. Channels
    // live on `lead.channels` (composable rows — no back-pointer).
    if (leadPayload.channels && leadPayload.channels.length > 0) {
      await syncLeadChannels(leadId, leadPayload.channels);
    }

    if (leadPayload.tenantIds?.length) {
      for (const tenantId of leadPayload.tenantIds) {
        const alreadyAssociated = (await genericCount({
          table: "lead",
          tenant: { id: tenantId },
          extraConditions: ["id = $leadId"],
          extraBindings: { leadId: rid(leadId) },
        })) > 0;
        if (!alreadyAssociated) {
          await associateLeadWithTenant({ leadId, tenantId });
        }
      }
    }

    if (leadPayload.faceDescriptor && leadPayload.faceDescriptor.length > 0) {
      await runLifecycleHooks("lead:verify", {
        leadId,
        systemSlug: leadPayload.systemSlug,
        systemId: leadPayload.systemId,
        faceDescriptor: leadPayload.faceDescriptor,
      });
    }
  }
  // auth.action.passwordReset is handled by /api/auth/reset-password,
  // not here.

  await markVerificationUsed(request.id);

  return Response.json({
    success: true,
    data: { message: "auth.verify.success", actionKey },
  });
}

export const POST = compose(withAuthRateLimit(), handler);
