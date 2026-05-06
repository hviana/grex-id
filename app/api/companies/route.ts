import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { createCompany } from "@/server/db/queries/companies";
import { genericList, genericUpdate } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import type { Company } from "@/src/contracts/company";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateFields } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const systemSlug = url.searchParams.get("systemSlug") ?? undefined;
  const isAnonymous = ctx.tenantContext.roles.includes("anonymous");
  const isSuperuser = ctx.tenantContext.roles.includes("superuser");

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  // Anonymous callers only see companies subscribed to the given system.
  // Authenticated non-superuser callers see only their own companies.
  // Superuser sees all companies.
  if (!isAnonymous && !isSuperuser) {
    const userId = ctx.tenantContext.tenant.actorId!;
    if (userId) {
      extraConditions.push(
        "id IN (SELECT VALUE companyId FROM tenant WHERE actorId = $userId AND companyId != NONE)",
      );
      extraBindings.userId = rid(userId);
    }
  }
  if (systemSlug) {
    extraConditions.push(
      "id IN (SELECT VALUE companyId FROM tenant WHERE systemId IN (SELECT VALUE id FROM system WHERE slug = $systemSlug) AND !actorId AND systemId != NONE)",
    );
    extraBindings.systemSlug = systemSlug;
  }

  const result = await genericList<Company>({
    table: "company",
    select: isAnonymous ? ["id", "name"] : undefined,
    searchFields: ["name"],
    cascade: isAnonymous
      ? []
      : [{ table: "address", sourceField: "billingAddressId" }],
    extraConditions,
    extraAccessFields: ["id"],
    allowRawExtraConditions: true,
    extraBindings,
    search,
    cursor,
    limit,
    allowSensitiveGlobalRead: true,
    skipAccessCheck: isAnonymous || extraConditions.length > 0,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { name, document, documentType, billingAddress } = body;

  const stdName = name
    ? await standardizeField("name", name, "company")
    : undefined;
  const stdDocument = document
    ? await standardizeField("document", document, "company")
    : undefined;

  const validationErrors = await validateFields(
    [
      { field: "name", value: stdName },
      {
        field: documentType === "cnpj" ? "cnpj" : "document",
        value: stdDocument,
      },
    ],
    "company",
  );
  const flatErrors = Object.values(validationErrors).flat();
  if (flatErrors.length > 0) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: flatErrors } },
      { status: 400 },
    );
  }

  const dup = await checkDuplicates("company", [
    { field: "document", value: stdDocument },
  ]);
  if (dup.isDuplicate) {
    const conflictErrors = dup.conflicts.map((c) =>
      `validation.${c.field}.duplicate`
    );
    return Response.json(
      { success: false, error: { code: "CONFLICT", errors: conflictErrors } },
      { status: 409 },
    );
  }

  // Company has no ownerId — owner resolved via tenant.isOwner = true.
  // Pass the current systemId from the tenant context.
  try {
    const company = await createCompany({
      name: stdName!,
      document: stdDocument!,
      documentType: documentType ?? "cnpj",
      billingAddress: billingAddress ?? {},
      ownerId: ctx.tenantContext.tenant.actorId!,
      systemId: ctx.tenantContext.tenant.systemId,
    });

    return Response.json(
      { success: true, data: company },
      { status: 201 },
    );
  } catch (e) {
    console.error(
      "[companies POST] createCompany error:",
      e instanceof Error ? e.message : String(e),
    );
    return Response.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
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

async function putHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { id, name, document, documentType } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (document !== undefined) updates.document = document;
  if (documentType !== undefined) updates.documentType = documentType;

  if (Object.keys(updates).length === 0) {
    return Response.json({ success: true, data: null });
  }

  try {
    const result = await genericUpdate<Company>(
      {
        table: "company",
        fields: [
          { field: "name" },
          { field: "document", entity: "company" },
          { field: "documentType" },
        ],
        skipAccessCheck: true,
      },
      id,
      updates,
    );

    if (!result.success) {
      if (result.duplicateFields?.length) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: result.duplicateFields.map(
                (f) => `validation.${f}.duplicate`,
              ),
            },
          },
          { status: 409 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors?.flatMap((e) => e.errors) ?? [],
          },
        },
        { status: 400 },
      );
    }

    return Response.json({ success: true, data: result.data });
  } catch (e) {
    console.error("[companies PUT]", e);
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => putHandler(req, ctx),
);
