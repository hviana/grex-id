import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  createLead,
  findLeadByChannelValues,
  getLeadHydrated,
  hydrateLeadFromCascade,
  LEAD_OWNER_CASCADE,
  removeLeadFromTenant,
  searchUsersInCompanySystem,
  updateLead,
} from "@/server/db/queries/leads";
import {
  genericAssociate,
  genericCount,
  genericList,
} from "@/server/db/queries/generics";
import { ensureCompanySystemTenant } from "@/server/db/queries/billing";
import type { Lead } from "@/src/contracts/lead";
import { rid } from "@/server/db/connection";
import { standardizeField } from "@/server/utils/field-standardizer";
import { parseBody } from "@/server/utils/parse-body";
import { validateField } from "@/server/utils/field-validator";
import type { SubmittedChannel } from "@/src/contracts/high-level/channels";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const action = url.searchParams.get("action");

  const companyId = ctx.tenantContext.tenant.companyId!;
  const systemId = ctx.tenantContext.tenant.systemId!;

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
    try {
      const lead = await getLeadHydrated(id, { companyId, systemId });
      return Response.json({ success: true, data: lead });
    } catch (e) {
      console.error("get-one lead error:", e);
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }
  }

  if (!companyId || !systemId) {
    return Response.json({
      success: true,
      items: [],
      total: 0,
      hasMore: false,
    });
  }

  const tagIdsRaw = url.searchParams.get("tagIds");
  const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : undefined;

  const result = await genericList<Lead>({
    table: "lead",
    select:
      "id, name, profileId, channelIds, tenantIds, ownerIds, tagIds, acceptsCommunication, createdAt, updatedAt",
    tenant: { companyId, systemId },
    search,
    searchFields: search ? ["profileId.name"] : undefined,
    cursor,
    limit,
    orderBy: "createdAt DESC",
    cascade: LEAD_OWNER_CASCADE,
    ...(tagIds?.length
      ? {
        extraConditions: ["tagIds CONTAINSANY $__tagIds"],
        extraBindings: { __tagIds: tagIds.map((t) => rid(t)) },
      }
      : {}),
  });

  const items = result.items.map((item) =>
    hydrateLeadFromCascade(item as unknown as Record<string, unknown>) ?? item
  );

  return Response.json({
    success: true,
    items,
    total: result.total,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
  });
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
  const { body, error } = await parseBody(req);
  if (error) return error;
  const companyId = ctx.tenantContext.tenant.companyId!;
  const systemId = ctx.tenantContext.tenant.systemId!;

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

  const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
  const { profile, ownerIds } = body;
  const acceptsCommunication = Boolean(body.acceptsCommunication);
  const channels = await parseChannels(body.channels);
  const name = body.name
    ? await standardizeField("name", body.name, "lead")
    : undefined;

  const errors: string[] = [...await validateField("name", name, "lead")];
  for (const ch of channels) {
    errors.push(...await validateField(ch.type, ch.value, "entity_channel"));
  }
  if (channels.length === 0) errors.push("validation.channel.required");

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
    const csTenant = { companyId, systemId };
    const alreadyAssociated = ((await genericCount({
      table: "lead",
      tenant: csTenant,
      extraConditions: ["id = $leadId"],
      extraBindings: { leadId: rid(existing.id) },
      extraAccessFields: ["id"],
      allowRawExtraConditions: true,
    })) as number) > 0;
    if (alreadyAssociated) {
      return Response.json(
        {
          success: false,
          error: {
            code: "DUPLICATE",
            errors: ["validation.lead.alreadyExists"],
          },
        },
        { status: 409 },
      );
    }
    await genericAssociate({ table: "lead" }, existing.id, {
      id: csTenantId,
    }, ctx.tenantContext.tenant);
    const refreshedLead = await getLeadHydrated(existing.id, {
      companyId,
      systemId,
    });
    return Response.json({
      success: true,
      data: refreshedLead ?? existing,
    });
  }

  const tags = Array.isArray(body.tags) ? body.tags : [];
  const ownerIdsArr = Array.isArray(body.ownerIds) ? body.ownerIds : [];
  const lead = await createLead({
    name: name!,
    profile,
    channels,
    tenantIds: [csTenantId],
    tags,
    ownerIds: ownerIdsArr,
    acceptsCommunication: acceptsCommunication,
    verified: true,
  });

  const hydrated = await getLeadHydrated(lead.id, { companyId, systemId });
  return Response.json(
    { success: true, data: hydrated ?? lead },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const companyId = ctx.tenantContext.tenant.companyId!;
  const systemId = ctx.tenantContext.tenant.systemId!;

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

  const { id, profile, ownerIds } = body;
  const acceptsCommunication = body.acceptsCommunication !== undefined
    ? Boolean(body.acceptsCommunication)
    : undefined;
  const name = body.name
    ? await standardizeField("name", body.name, "lead")
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

  const tags = body.tags !== undefined ? body.tags : undefined;
  const ownerIdsArr = body.ownerIds !== undefined ? body.ownerIds : undefined;
  const lead = await updateLead(id, {
    name,
    profile,
    tags,
    ownerIds: ownerIdsArr,
    acceptsCommunication,
  });

  const refreshedLead = await getLeadHydrated(id, { companyId, systemId });

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
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const companyId = ctx.tenantContext.tenant.companyId!;
  const systemId = ctx.tenantContext.tenant.systemId!;

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

  const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
  await removeLeadFromTenant(id, csTenantId);
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);
