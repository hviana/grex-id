import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  createLead,
  findLeadByChannelValues,
  getLeadHydrated,
  updateLead,
} from "@/server/db/queries/leads";
import { genericAssociate, genericCount } from "@/server/db/queries/generics";
import { ensureCompanySystemTenant } from "@/server/db/queries/billing";
import { rid } from "@/server/db/connection";
import {
  linkOrphanFaceToLead,
  searchOrphanFaceByEmbedding,
  tryUpsertFace,
} from "@systems/grex-id/server/db/queries/faces";
import { get } from "@/server/utils/cache";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

async function postHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;

  try {
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.json.invalid"],
          },
        },
        { status: 400 },
      );
    }
    body = parsedBody;
    const companyId = ctx.tenantContext.tenant.companyId!;
    const systemId = ctx.tenantContext.tenant.systemId!;
    const csTenantId = companyId && systemId
      ? await ensureCompanySystemTenant({ companyId, systemId })
      : undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const ownerIds = Array.isArray(parsedBody.ownerIds)
      ? (parsedBody.ownerIds as string[])
      : [];
    const acceptsCommunication = Boolean(parsedBody.acceptsCommunication);
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const rawChannels = Array.isArray(parsedBody.channels)
      ? parsedBody.channels as { type: string; value: string }[]
      : [];
    const emailChannel = rawChannels.find((c) => c.type === "email");
    const phoneChannel = rawChannels.find((c) => c.type === "phone");
    const email = emailChannel
      ? await standardizeField("email", emailChannel.value, "lead")
      : undefined;
    const phone = phoneChannel
      ? await standardizeField("phone", phoneChannel.value, "lead")
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
      const csTenant = { companyId, systemId };
      const alreadyAssociated = ((await genericCount({
        table: "lead",
        tenant: csTenant,
        extraConditions: ["id = $leadId"],
        extraBindings: { leadId: rid(existing.id) },
        extraAccessFields: ["id"],
        allowRawExtraConditions: true,
      })) as number) > 0;

      if (!alreadyAssociated) {
        await genericAssociate({ table: "lead" }, existing.id, {
          id: csTenantId!,
        }, ctx.tenantContext.tenant);
      }

      lead = await updateLead(existing.id, {
        name: name!,
        profile,
        ownerIds,
        acceptsCommunication,
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
        tenantIds: csTenantId ? [csTenantId] : [],
        ownerIds,
        acceptsCommunication,
        verified: true,
      });
    }

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      const tenantData = await get(
        { systemId, companyId },
        "tenant-data",
      ) as Record<string, unknown> | undefined;
      const sensitivity = Number(
        tenantData?.["detection.sensitivity"] ?? 0.5,
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
          tenantId: csTenantId!,
        });
      }
    }

    const hydrated = await getLeadHydrated(lead.id, { companyId, systemId });
    return Response.json(
      { success: true, data: hydrated ?? lead },
      { status: 201 },
    );
  } catch (error) {
    console.error("Grex assisted lead route error:", {
      method: "POST",
      companyId: body?.companyId ?? ctx.tenantContext.tenant.companyId,
      systemId: body?.systemId ?? ctx.tenantContext.tenant.systemId,
      ownerIds: body?.ownerIds,
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
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.json.invalid"],
          },
        },
        { status: 400 },
      );
    }
    body = parsedBody;
    const companyId = ctx.tenantContext.tenant.companyId!;
    const systemId = ctx.tenantContext.tenant.systemId!;
    const csTenantId = companyId && systemId
      ? await ensureCompanySystemTenant({ companyId, systemId })
      : undefined;
    const id = parsedBody.id as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; dateOfBirth?: string }
      | undefined;
    const ownerIds = Array.isArray(parsedBody.ownerIds)
      ? (parsedBody.ownerIds as string[])
      : [];
    const acceptsCommunication = parsedBody.acceptsCommunication !== undefined
      ? Boolean(parsedBody.acceptsCommunication)
      : undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const rawChannels = Array.isArray(parsedBody.channels)
      ? parsedBody.channels as { type: string; value: string }[]
      : [];
    const emailChannel = rawChannels.find((c) => c.type === "email");
    const phoneChannel = rawChannels.find((c) => c.type === "phone");
    const email = emailChannel
      ? await standardizeField("email", emailChannel.value, "lead")
      : undefined;
    const phone = phoneChannel
      ? await standardizeField("phone", phoneChannel.value, "lead")
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
      ownerIds,
      acceptsCommunication,
    });

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      const tenantData = await get(
        { systemId, companyId },
        "tenant-data",
      ) as Record<string, unknown> | undefined;
      const sensitivity = Number(
        tenantData?.["detection.sensitivity"] ?? 0.5,
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
          tenantId: csTenantId!,
        });
      }
    }

    const hydrated = await getLeadHydrated(id, { companyId, systemId });
    return Response.json({
      success: true,
      data: hydrated ?? lead,
    });
  } catch (error) {
    console.error("Grex assisted lead route error:", {
      method: "PUT",
      id: body?.id,
      companyId: body?.companyId ?? ctx.tenantContext.tenant.companyId,
      systemId: body?.systemId ?? ctx.tenantContext.tenant.systemId,
      ownerIds: body?.ownerIds,
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
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{
      systemSlug: "grex-id",
      roles: ["admin", "grexid.manage_leads"],
    }],
  }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{
      systemSlug: "grex-id",
      roles: ["admin", "grexid.manage_leads"],
    }],
  }),
  async (req, ctx) => putHandler(req, ctx),
);
