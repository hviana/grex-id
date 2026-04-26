import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createCompany } from "@/server/db/queries/companies";
import { genericList } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import type { Company } from "@/src/contracts/company";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateFields } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const systemSlug = url.searchParams.get("systemSlug") ?? undefined;
  const userId = ctx.tenant.actorId!;

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};
  if (userId) {
    extraConditions.push(
      "id IN (SELECT VALUE companyId FROM tenant WHERE actorId = $userId AND companyId != NONE)",
    );
    extraBindings.userId = rid(userId);
  }
  if (systemSlug) {
    extraConditions.push(
      "id IN (SELECT VALUE companyId FROM tenant WHERE systemId = (SELECT id FROM system WHERE slug = $systemSlug LIMIT 1) AND actorId = NONE AND systemId != NONE)",
    );
    extraBindings.systemSlug = systemSlug;
  }

  const result = await genericList<Company>({
    table: "company",
    searchFields: ["name"],
    fetch: "billingAddressId",
    extraConditions,
    extraBindings,
    search,
    cursor,
    limit,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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
      { field: "cnpj", value: stdDocument },
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
  const company = await createCompany({
    name: stdName!,
    document: stdDocument!,
    documentType: documentType ?? "cnpj",
    billingAddress: billingAddress ?? {},
    ownerId: ctx.tenant.actorId!,
    systemId: ctx.tenant.systemId,
  });

  return Response.json(
    { success: true, data: company },
    { status: 201 },
  );
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
