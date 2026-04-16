import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  associateLeadWithCompanySystem,
  createLead,
  findLeadByEmailOrPhone,
  isLeadAssociated,
  syncLeadCompanyIds,
  updateLead,
  updateLeadOwner,
} from "@/server/db/queries/leads";
import { tryUpsertFace } from "@/server/db/queries/systems/grex-id/faces";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

async function postHandler(req: Request, ctx: RequestContext) {
  let body: Record<string, unknown> | null = null;

  try {
    const parsedBody = await req.json() as Record<string, unknown>;
    body = parsedBody;
    const companyId = parsedBody.companyId || ctx.tenant.companyId;
    const systemId = parsedBody.systemId || ctx.tenant.systemId;
    const inferredCompanyIds = companyId ? [companyId as string] : [];
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; age?: number }
      | undefined;
    const ownerId = parsedBody.ownerId as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const email = parsedBody.email
      ? standardizeField("email", String(parsedBody.email), "lead")
      : undefined;
    const phone = parsedBody.phone
      ? standardizeField("phone", String(parsedBody.phone), "lead")
      : undefined;
    const name = parsedBody.name
      ? standardizeField("name", String(parsedBody.name), "lead")
      : undefined;

    const emailErrors = validateField("email", email, "lead");
    const nameErrors = validateField("name", name, "lead");
    const allErrors = [...emailErrors, ...nameErrors];

    if (!companyId || !systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.companyAndSystem.required",
          },
        },
        { status: 400 },
      );
    }

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

    // Use avatarUri from facial capture as the profile avatar
    if (avatarUri && profile) {
      (profile as { avatarUri?: string }).avatarUri = avatarUri as string;
    }

    let lead;
    const existing = await findLeadByEmailOrPhone(email!, phone);

    if (existing) {
      const alreadyAssociated = await isLeadAssociated(
        existing.id,
        companyId as string,
        systemId as string,
      );

      if (!alreadyAssociated) {
        await associateLeadWithCompanySystem({
          leadId: existing.id,
          companyId: companyId as string,
          systemId: systemId as string,
          ownerId: ownerId as string | undefined,
        });
      }

      lead = await updateLead(existing.id, {
        name: name!,
        email: email!,
        phone,
        profile,
      });
      await syncLeadCompanyIds(existing.id);
    } else {
      const dup = await checkDuplicates("lead", [
        { field: "email", value: email! },
        { field: "phone", value: phone },
      ]);
      if (dup.isDuplicate) {
        return Response.json(
          {
            success: false,
            error: {
              code: "DUPLICATE",
              message: "validation.lead.duplicateContact",
            },
          },
          { status: 409 },
        );
      }

      lead = await createLead({
        name: name!,
        email: email!,
        phone,
        profile: profile as {
          name: string;
          avatarUri?: string;
          age?: number;
        },
        companyIds: inferredCompanyIds,
      });
      await associateLeadWithCompanySystem({
        leadId: lead.id,
        companyId: companyId as string,
        systemId: systemId as string,
        ownerId: ownerId as string | undefined,
      });
    }

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      await tryUpsertFace({
        leadId: lead.id,
        embedding_type1: faceDescriptor as number[],
      }, {
        route: "systems/grex-id/leads:POST",
        companyId: companyId as string,
        systemId: systemId as string,
      });
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
              message: "validation.companyAndSystem.required",
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
    const companyId = parsedBody.companyId || ctx.tenant.companyId;
    const systemId = parsedBody.systemId || ctx.tenant.systemId;
    const id = parsedBody.id as string | undefined;
    const profile = parsedBody.profile as
      | { name?: string; avatarUri?: string; age?: number }
      | undefined;
    const ownerId = parsedBody.ownerId as string | undefined;
    const faceDescriptor = parsedBody.faceDescriptor as number[] | undefined;
    const avatarUri = parsedBody.avatarUri as string | undefined;
    const email = parsedBody.email
      ? standardizeField("email", parsedBody.email, "lead")
      : undefined;
    const phone = parsedBody.phone
      ? standardizeField("phone", parsedBody.phone, "lead")
      : undefined;
    const name = parsedBody.name
      ? standardizeField("name", parsedBody.name, "lead")
      : undefined;

    if (!id) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "validation.id.required" },
        },
        { status: 400 },
      );
    }

    if (!companyId || !systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.companyAndSystem.required",
          },
        },
        { status: 400 },
      );
    }

    if (avatarUri && profile) {
      (profile as { avatarUri?: string }).avatarUri = avatarUri as string;
    }

    const lead = await updateLead(id as string, {
      name,
      email,
      phone,
      profile,
    });

    if (ownerId !== undefined) {
      await updateLeadOwner(
        id as string,
        companyId as string,
        systemId as string,
        (ownerId as string) || null,
      );
    }

    if (faceDescriptor && Array.isArray(faceDescriptor)) {
      await tryUpsertFace({
        leadId: id as string,
        embedding_type1: faceDescriptor as number[],
      }, {
        route: "systems/grex-id/leads:PUT",
        companyId: companyId as string,
        systemId: systemId as string,
      });
    }

    await syncLeadCompanyIds(id as string);
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
              message: "validation.companyAndSystem.required",
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
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => putHandler(req, ctx),
);
