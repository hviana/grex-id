import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import {
  associateLeadWithCompanySystem,
  createLead,
  findLeadByEmailOrPhone,
  getLeadById,
  isLeadAssociated,
  listLeads,
  removeLeadFromCompanySystem,
  searchUsersInCompanySystem,
  syncLeadCompanyIds,
  updateLead,
  updateLeadOwner,
} from "@/server/db/queries/leads";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const action = url.searchParams.get("action");

  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;

  if (action === "search-owners") {
    const q = url.searchParams.get("q") ?? "";
    const users = await searchUsersInCompanySystem(
      companyId,
      systemId,
      q,
    );
    return Response.json({ success: true, data: users });
  }

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const lead = await getLeadById(id);
    return Response.json({ success: true, data: lead });
  }

  const result = await listLeads({
    limit,
    cursor,
    search,
    companyId,
    systemId,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const companyId = body.companyId || ctx.tenant.companyId;
  const systemId = body.systemId || ctx.tenant.systemId;
  const inferredCompanyIds = companyId ? [companyId] : [];
  const { profile, ownerId } = body;
  const email = body.email
    ? standardizeField("email", body.email, "lead")
    : undefined;
  const phone = body.phone
    ? standardizeField("phone", body.phone, "lead")
    : undefined;
  const name = body.name
    ? standardizeField("name", body.name, "lead")
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

  const existing = await findLeadByEmailOrPhone(email!, phone);

  if (existing) {
    const alreadyAssociated = await isLeadAssociated(
      existing.id,
      companyId,
      systemId,
    );
    if (alreadyAssociated) {
      return Response.json(
        {
          success: false,
          error: {
            code: "DUPLICATE",
            message: "validation.lead.alreadyExists",
          },
        },
        { status: 409 },
      );
    }
    await associateLeadWithCompanySystem({
      leadId: existing.id,
      companyId,
      systemId,
      ownerId,
    });
    const refreshedLead = await getLeadById(existing.id);
    return Response.json({
      success: true,
      data: refreshedLead ?? existing,
    });
  }

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

  const tags = Array.isArray(body.tags) ? body.tags : [];
  const lead = await createLead({
    name: name!,
    email: email!,
    phone,
    profile,
    companyIds: inferredCompanyIds,
    tags,
  });
  await associateLeadWithCompanySystem({
    leadId: lead.id,
    companyId,
    systemId,
    ownerId,
  });

  return Response.json({ success: true, data: lead }, { status: 201 });
}

async function putHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const companyId = body.companyId || ctx.tenant.companyId;
  const systemId = body.systemId || ctx.tenant.systemId;
  const { id, profile, ownerId } = body;
  const email = body.email
    ? standardizeField("email", body.email, "lead")
    : undefined;
  const phone = body.phone
    ? standardizeField("phone", body.phone, "lead")
    : undefined;
  const name = body.name
    ? standardizeField("name", body.name, "lead")
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

  const tags = body.tags !== undefined ? body.tags : undefined;
  const lead = await updateLead(id, { name, email, phone, profile, tags });

  if (ownerId !== undefined) {
    await updateLeadOwner(id, companyId, systemId, ownerId || null);
  }

  await syncLeadCompanyIds(id);
  const refreshedLead = await getLeadById(id);

  return Response.json({
    success: true,
    data: refreshedLead ?? lead,
  });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;
  await removeLeadFromCompanySystem(id, companyId, systemId);
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

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

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
