import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  associateLeadWithTenant,
  createLead,
  findLeadByChannelValues,
  getLeadById,
  listLeads,
  removeLeadFromTenant,
  searchUsersInCompanySystem,
  updateLead,
} from "@/server/db/queries/leads";
import { genericCount } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const action = url.searchParams.get("action");

  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

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

  if (!companyId || !systemId) {
    return Response.json({
      success: true,
      items: [],
      total: 0,
      hasMore: false,
    });
  }

  const result = await listLeads({
    limit,
    cursor,
    search,
    tenantId: ctx.tenant.id,
  });

  return Response.json({ success: true, ...result });
}

interface SubmittedChannel {
  type: string;
  value: string;
}

async function parseChannels(raw: unknown): Promise<SubmittedChannel[]> {
  if (!Array.isArray(raw)) return [];
  const out: SubmittedChannel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const t = (entry as { type?: unknown }).type;
    const v = (entry as { value?: unknown }).value;
    if (typeof t !== "string" || typeof v !== "string") continue;
    const std = await standardizeField(t, v, "entity_channel");
    if (std.length === 0) continue;
    out.push({ type: t, value: std });
  }
  return out;
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;
  const tenantId = ctx.tenant.id;
  const inferredTenantIds = tenantId ? [tenantId] : [];
  const { profile, ownerId } = body;
  const channels = await parseChannels(body.channels);
  const name = body.name
    ? await standardizeField("name", body.name, "lead")
    : undefined;

  const errors: string[] = [...await validateField("name", name, "lead")];
  for (const ch of channels) {
    errors.push(...await validateField(ch.type, ch.value, "entity_channel"));
  }
  if (channels.length === 0) errors.push("validation.channel.required");

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

  if (!profile?.name || errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: errors.length > 0 ? errors : ["validation.name.required"],
        },
      },
      { status: 400 },
    );
  }

  const existing = await findLeadByChannelValues(channels.map((c) => c.value));

  if (existing) {
    const alreadyAssociated = (await genericCount({
      table: "lead",
      tenant: { id: tenantId },
      extraConditions: ["id = $leadId"],
      extraBindings: { leadId: rid(existing.id) },
    })) > 0;
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
    await associateLeadWithTenant({
      leadId: existing.id,
      tenantId,
    });
    const refreshedLead = await getLeadById(existing.id);
    return Response.json({
      success: true,
      data: refreshedLead ?? existing,
    });
  }

  const tags = Array.isArray(body.tags) ? body.tags : [];
  const lead = await createLead({
    name: name!,
    profile,
    channels,
    tenantIds: inferredTenantIds,
    tags,
  });
  await associateLeadWithTenant({
    leadId: lead.id,
    tenantId,
  });

  return Response.json({ success: true, data: lead }, { status: 201 });
}

async function putHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;
  const { id, profile, ownerId } = body;
  const name = body.name
    ? await standardizeField("name", body.name, "lead")
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
  const lead = await updateLead(id, { name, profile, tags });

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

  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;
  await removeLeadFromTenant(id, ctx.tenant.id);
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
