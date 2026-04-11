import { NextRequest, NextResponse } from "next/server";
import {
  findVerificationRequest,
  markEmailVerified,
  markVerificationUsed,
} from "@/server/db/queries/auth";
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
  if (!payload) {
    return {};
  }

  const rawProfile = payload.profile;
  const profile = rawProfile && typeof rawProfile === "object"
    ? (() => {
      const profileObject = rawProfile as Record<string, unknown>;
      return {
        name: typeof profileObject.name === "string"
          ? profileObject.name
          : undefined,
        avatarUri: typeof profileObject.avatarUri === "string"
          ? profileObject.avatarUri
          : undefined,
        age: typeof profileObject.age === "number"
          ? profileObject.age
          : undefined,
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
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token } = body;

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  const request = await findVerificationRequest(token);
  if (!request) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 400 },
    );
  }

  if (request.usedAt) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ALREADY_USED",
          message: "auth.error.linkUsed",
        },
      },
      { status: 400 },
    );
  }

  if (new Date(request.expiresAt) < new Date()) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "EXPIRED", message: "auth.error.linkExpired" },
      },
      { status: 400 },
    );
  }

  if (
    request.type === "email_verify" &&
    typeof request.userId === "string" &&
    request.userId.startsWith("user:")
  ) {
    await markEmailVerified(request.userId);
  } else if (
    request.type === "lead_update" ||
    (
      request.type === "email_verify" &&
      typeof request.userId === "string" &&
      request.userId.startsWith("lead:")
    )
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

  return NextResponse.json({
    success: true,
    data: { message: "auth.verify.success" },
  });
}
