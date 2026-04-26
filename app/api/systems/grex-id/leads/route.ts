import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  associateLeadWithTenant,
  createLead,
  findLeadByChannelValues,
  isLeadAssociated,
  updateLead,
} from "@/server/db/queries/leads";
import {
  linkOrphanFaceToLead,
  searchOrphanFaceByEmbedding,
  tryUpsertFace,
} from "@/server/db/queries/systems/grex-id/faces";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

async function postHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;

  try {
    const parsedBody = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const companyId = ctx.tenant.companyId;
    const systemId = ctx.tenant.systemId;
    const tenantId = ctx.tenant.id;
    const inferredTenantIds = tenantId ? [tenantId] : [];
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const ownerId = parsedBody.ownerId as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const email = parsedBody.email
      ? await standardizeField("email", String(parsedBody.email), "lead")
      : undefined;
    const phone = parsedBody.phone
      ? await standardizeField("phone", String(parsedBody.phone), "lead")
      : undefined;
    const name = parsedBody.name
      ? await standardizeField("name", String(parsedBody.name), "lead")
      : undefined;

    if (!companyId || !systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.companyAndSystem.required"],
          },
        },
        { status: 400 },
      );
    }

    const emailErrors = await validateField("email", email, "lead");
    const nameErrors = await validateField("name", name, "lead");
    const allErrors = [...emailErrors, ...nameErrors];

    if (!profile?.name || allErrors.length > 0) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: allErrors.length > 0
              ? allErrors
              : ["validation.name.required"],
          },
        },
        { status: 400 },
      );
    }

    if (avatarUri && profile) {
      (profile as { avatarUri?: string }).avatarUri = avatarUri;
    }

    const submittedChannels: { type: string; value: string }[] = [
      ...(email ? [{ type: "email", value: email }] : []),
      ...(phone ? [{ type: "phone", value: phone }] : []),
    ];

    let lead;
    const existing = submittedChannels.length > 0
      ? await findLeadByChannelValues(submittedChannels.map((c) => c.value))
      : null;

    if (existing) {
      const alreadyAssociated = await isLeadAssociated(
        existing.id,
        tenantId,
      );

      if (!alreadyAssociated) {
        await associateLeadWithTenant({
          leadId: existing.id,
          tenantId,
        });
      }

      lead = await updateLead(existing.id, {
        name: name!,
        profile,
      });
    } else {
      lead = await createLead({
        name: name!,
        profile: profile as {
          name: string;
          avatarUri?: string;
          dateOfBirth?: string;
        },
        channels: submittedChannels,
        tenantIds: inferredTenantIds,
      });
      await associateLeadWithTenant({
        leadId: lead.id,
        tenantId,
      });
    }

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      const sensitivity = parseFloat(
        (await Core.getInstance().getSetting(
          "detection.sensitivity",
          { systemId, companyId },
        )) ?? "0.5",
      );
      const orphanMatch = await searchOrphanFaceByEmbedding(
        faceDescriptor,
        sensitivity,
      );
      if (orphanMatch.length > 0) {
        await linkOrphanFaceToLead(orphanMatch[0].id, lead.id);
      } else {
        await tryUpsertFace({
          leadId: lead.id,
          embedding_type1: faceDescriptor,
        }, {
          route: "systems/grex-id/leads:POST",
          tenantId,
        });
      }
    }

    return Response.json(
      { success: true, data: lead },
      { status: 201 },
    );
  } catch (error) {
    console.error("Grex assisted lead route error:", {
      method: "POST",
      companyId: body?.companyId ?? ctx.tenant.companyId,
      systemId: body?.systemId ?? ctx.tenant.systemId,
      ownerId: body?.ownerId,
      error,
    });

    if (
      error instanceof Error &&
      error.message.startsWith("INVALID_RECORD_ID:")
    ) {
      const field = error.message.slice("INVALID_RECORD_ID:".length);
      if (field === "companyId" || field === "systemId") {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              errors: ["validation.companyAndSystem.required"],
            },
          },
          { status: 400 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "ERROR",
            message: "common.error.generic",
          },
        },
        { status: 500 },
      );
    }

    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "common.error.generic",
        },
      },
      { status: 500 },
    );
  }
}

async function putHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;

  try {
    const parsedBody = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const companyId = ctx.tenant.companyId;
    const systemId = ctx.tenant.systemId;
    const tenantId = ctx.tenant.id;
    const id = parsedBody.id as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const ownerId = parsedBody.ownerId as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const email = parsedBody.email
      ? await standardizeField("email", String(parsedBody.email), "lead")
      : undefined;
    const phone = parsedBody.phone
      ? await standardizeField("phone", String(parsedBody.phone), "lead")
      : undefined;
    const name = parsedBody.name
      ? await standardizeField("name", String(parsedBody.name), "lead")
      : undefined;

    if (!id) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["validation.id.required"] },
        },
        { status: 400 },
      );
    }

    if (avatarUri && profile) {
      (profile as { avatarUri?: string }).avatarUri = avatarUri;
    }

    const lead = await updateLead(id, {
      name,
      profile,
    });

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      const sensitivity = parseFloat(
        (await Core.getInstance().getSetting(
          "detection.sensitivity",
          { systemId, companyId },
        )) ?? "0.5",
      );
      const orphanMatch = await searchOrphanFaceByEmbedding(
        faceDescriptor,
        sensitivity,
      );
      if (orphanMatch.length > 0) {
        await linkOrphanFaceToLead(orphanMatch[0].id, id);
      } else {
        await tryUpsertFace({
          leadId: id,
          embedding_type1: faceDescriptor,
        }, {
          route: "systems/grex-id/leads:PUT",
          tenantId,
        });
      }
    }

    return Response.json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error("Grex assisted lead route error:", {
      method: "PUT",
      id: body?.id,
      companyId: body?.companyId ?? ctx.tenant.companyId,
      systemId: body?.systemId ?? ctx.tenant.systemId,
      ownerId: body?.ownerId,
      error,
    });

    if (
      error instanceof Error &&
      error.message.startsWith("INVALID_RECORD_ID:")
    ) {
      const field = error.message.slice("INVALID_RECORD_ID:".length);
      if (field === "companyId" || field === "systemId") {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              errors: ["validation.companyAndSystem.required"],
            },
          },
          { status: 400 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "ERROR",
            message: "common.error.generic",
          },
        },
        { status: 500 },
      );
    }

    return Response.json(
      {
        success: false,
        error: {
          code: "ERROR",
          message: "common.error.generic",
        },
      },
      { status: 500 },
    );
  }
}

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ roles: ["grexid.manage_leads"] }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ roles: ["grexid.manage_leads"] }),
  async (req, ctx) => putHandler(req, ctx),
);
