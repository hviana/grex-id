import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import {
  findVerificationRequest,
  markEmailVerified,
  markVerificationUsed,
} from "@/server/db/queries/auth";
import {
  verifyRecoveryChannel,
} from "@/server/db/queries/recovery-channels";
import {
  associateLeadWithCompanySystem,
  isLeadAssociated,
  syncLeadCompanyIds,
  updateLead,
} from "@/server/db/queries/leads";
import { tryUpsertFace } from "@/server/db/queries/systems/grex-id/faces";

interface LeadUpdatePayload {
  name?: string;
  email?: string;
  phone?: string;
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

  return {
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    phone: typeof payload.phone === "string" ? payload.phone : undefined,
    profile,
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    companyIds: Array.isArray(payload.companyIds)
      ? payload.companyIds.filter(
        (companyId): companyId is string => typeof companyId === "string",
      )
      : undefined,
    systemId: typeof payload.systemId === "string" ? payload.systemId : undefined,
    systemSlug: typeof payload.systemSlug === "string" ? payload.systemSlug : undefined,
    faceDescriptor: Array.isArray(payload.faceDescriptor)
      ? payload.faceDescriptor.filter(
        (value): value is number => typeof value === "number",
      )
      : undefined,
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

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const body = await req.json();
  const { token } = body;

  if (!token) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", message: "validation.token.required" } },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request) {
    return Response.json(
      { success: false, error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" } },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return Response.json(
      { success: false, error: { code: "ALREADY_USED", message: "auth.error.linkUsed" } },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return Response.json(
      { success: false, error: { code: "EXPIRED", message: "auth.error.linkExpired" } },
      { status: 400 },
    );
  }

  if (
    request.type === "email_verify" &&
    typeof request.userId === "string" &&
    request.userId.startsWith("user:")
  ) {
    await markEmailVerified(request.userId);
  } else if (request.type === "recovery_verify") {
    // Verify a recovery channel
    const payload = request.payload as Record<string, unknown> | null;
    const channelId = payload?.channelId as string | undefined;
    if (channelId) {
      await verifyRecoveryChannel(channelId);
    }
  } else if (
    request.type === "lead_update" ||
    (request.type === "email_verify" &&
      typeof request.userId === "string" &&
      request.userId.startsWith("lead:"))
  ) {
    const payload = parseLeadUpdatePayload(request.payload);

    await updateLead(request.userId, {
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      profile: payload.profile,
      tags: payload.tags,
    });

    if (payload.systemId && payload.companyIds?.length) {
      for (const companyId of payload.companyIds) {
        const alreadyAssociated = await isLeadAssociated(
          request.userId,
          companyId,
          payload.systemId,
        );
        if (!alreadyAssociated) {
          await associateLeadWithCompanySystem({
            leadId: request.userId,
            companyId,
            systemId: payload.systemId,
          });
        }
      }
    }

    await syncLeadCompanyIds(request.userId);

    if (
      payload.systemSlug === "grex-id" &&
      payload.faceDescriptor &&
      payload.faceDescriptor.length > 0
    ) {
      await tryUpsertFace({
        leadId: request.userId,
        embedding_type1: payload.faceDescriptor,
      }, {
        route: "auth/verify:POST",
        systemSlug: payload.systemSlug,
        systemId: payload.systemId,
      });
    }
  }

  await markVerificationUsed(request.id);

  return Response.json({
    success: true,
    data: { message: "auth.verify.success" },
  });
}

export const POST = compose(withAuthRateLimit(), handler);
