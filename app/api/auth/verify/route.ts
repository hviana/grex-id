import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  applyPasswordHash,
  findUserByVerifiedChannel,
  findVerificationRequest,
  markVerificationUsed,
} from "@/server/db/queries/auth";
import { verifyChannels } from "@/server/db/queries/entity-channels";
import {
  associateLeadWithCompanySystem,
  isLeadAssociated,
  syncLeadCompanyIds,
  updateLead,
} from "@/server/db/queries/leads";
import { runLifecycleHooks } from "@/server/module-registry";
import { getDb, rid } from "@/server/db/connection";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";

interface LeadUpdatePayload {
  name?: string;
  profile?: {
    name?: string;
    avatarUri?: string;
    age?: number;
  };
  tags?: string[];
  companyIds?: string[];
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
        age: typeof p.age === "number" ? p.age : undefined,
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
    companyIds: Array.isArray(payload.companyIds)
      ? payload.companyIds.filter(
        (companyId): companyId is string => typeof companyId === "string",
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
    // Apply the precomputed argon2 hash stored on the request payload (§19.14).
    const hash = typeof payload?.newPasswordHash === "string"
      ? payload!.newPasswordHash
      : "";
    if (hash) {
      await applyPasswordHash(request.ownerId, hash);
    }
  } else if (actionKey === "auth.action.twoFactorEnable") {
    // Promote the user's pendingTwoFactorSecret (set by `setup-totp` and
    // validated by `confirm-totp`) to twoFactorSecret. The secret never
    // travels through the verification_request payload (§15.1 rule 5).
    // The entire read-then-conditional-write is a single batched query per
    // §7.2 so the user can't slip in between.
    const db = await getDb();
    await db.query(
      `LET $u = (SELECT pendingTwoFactorSecret FROM $userId LIMIT 1);
       IF array::len($u) > 0 AND $u[0].pendingTwoFactorSecret != NONE {
         UPDATE $userId SET
           twoFactorEnabled = true,
           twoFactorSecret = $u[0].pendingTwoFactorSecret,
           pendingTwoFactorSecret = NONE,
           updatedAt = time::now();
       };`,
      { userId: rid(request.ownerId) },
    );
  } else if (actionKey === "auth.action.twoFactorDisable") {
    const db = await getDb();
    await db.query(
      `UPDATE $userId SET
        twoFactorEnabled = false,
        twoFactorSecret = NONE,
        pendingTwoFactorSecret = NONE,
        updatedAt = time::now()`,
      { userId: rid(request.ownerId) },
    );
  } else if (actionKey === "auth.action.loginFallback") {
    // Issue a System API Token for the user, bypassing TOTP since the click
    // on a time-bound single-use confirmation link already proved control of
    // a verified channel (§19.15.3).
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

      const db = await getDb();
      const membership = await db.query<
        [{
          companyId: string;
          systemId: string;
          systemSlug: string;
          roles: string[];
          permissions: string[];
        }[]]
      >(
        `LET $ucs = (SELECT companyId, systemId FROM user_company_system WHERE userId = $userId LIMIT 1);
         IF array::len($ucs) > 0 {
           LET $sys = (SELECT slug FROM system WHERE id = $ucs[0].systemId LIMIT 1);
           LET $roleRecs = (SELECT permissions FROM role WHERE systemId = $ucs[0].systemId AND id IN (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles);
           SELECT
             $ucs[0].companyId AS companyId,
             $ucs[0].systemId AS systemId,
             $sys[0].slug AS systemSlug,
             (SELECT roles FROM user_company_system WHERE userId = $userId AND companyId = $ucs[0].companyId AND systemId = $ucs[0].systemId LIMIT 1)[0].roles AS roles,
             array::flatten($roleRecs[*].permissions) AS permissions
           FROM system WHERE id = $ucs[0].systemId LIMIT 1;
         } ELSE {
           RETURN [];
         };`,
        { userId: rid(String(user.id)) },
      );

      const mem = membership[0]?.[0];
      const tenant = mem
        ? {
          systemId: String(mem.systemId),
          companyId: String(mem.companyId),
          systemSlug: mem.systemSlug ?? "core",
          roles: (mem.roles ?? []) as string[],
          permissions: (mem.permissions ?? []) as string[],
        }
        : {
          systemId: "0",
          companyId: "0",
          systemSlug: "core",
          roles: [] as string[],
          permissions: [] as string[],
        };

      const isSuperuser = (user.roles ?? []).includes("superuser");
      if (isSuperuser) {
        tenant.roles = ["superuser"];
        tenant.permissions = ["*"];
      }

      const systemToken = await createTenantToken(
        {
          ...tenant,
          actorType: "user",
          actorId: String(user.id),
          exchangeable: true,
        },
        stayLoggedIn,
      );

      await rememberActor(tenant, String(user.id));

      return Response.json({
        success: true,
        data: {
          message: "auth.verify.success",
          actionKey,
          systemToken,
          user: {
            id: user.id,
            profile: user.profile,
            roles: user.roles,
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
    // live on `lead.channels` (composable rows — no back-pointer). Each
    // update: if the lead already references a matching (type, value) row,
    // flip it to verified; otherwise create a new verified channel and
    // append its id to `lead.channels`. One batched query per channel.
    if (leadPayload.channels && leadPayload.channels.length > 0) {
      const db = await getDb();
      for (const ch of leadPayload.channels) {
        await db.query(
          `LET $lead = (SELECT channels FROM lead WHERE id = $owner)[0];
           LET $ids  = IF $lead = NONE THEN [] ELSE $lead.channels END;
           LET $existing = (SELECT id FROM entity_channel
             WHERE id IN $ids AND type = $type AND value = $value
             LIMIT 1);
           LET $new = IF $lead != NONE AND array::len($existing) = 0 THEN (
             CREATE entity_channel SET
               type = $type, value = $value, verified = true
           ) ELSE [] END;
           LET $appended = IF array::len($new) > 0 THEN (
             UPDATE $owner SET
               channels += $new[0].id,
               updatedAt = time::now()
           ) ELSE [] END;
           LET $flipped = IF array::len($existing) > 0 THEN (
             UPDATE $existing[0].id SET
               verified = true,
               updatedAt = time::now()
           ) ELSE [] END;`,
          {
            owner: rid(leadId),
            type: ch.type,
            value: ch.value,
          },
        );
      }
    }

    if (leadPayload.systemId && leadPayload.companyIds?.length) {
      for (const companyId of leadPayload.companyIds) {
        const alreadyAssociated = await isLeadAssociated(
          leadId,
          companyId,
          leadPayload.systemId,
        );
        if (!alreadyAssociated) {
          await associateLeadWithCompanySystem({
            leadId,
            companyId,
            systemId: leadPayload.systemId,
          });
        }
      }
    }

    await syncLeadCompanyIds(leadId);

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
