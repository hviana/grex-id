import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createCompany, listCompanies } from "@/server/db/queries/companies";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateFields } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const result = await listCompanies({
    search,
    cursor,
    limit,
    userId: ctx.claims?.actorId ?? "0",
  });
  return Response.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { name, document, documentType, billingAddress } = body;

  const stdName = name ? standardizeField("name", name, "company") : undefined;
  const stdDocument = document
    ? standardizeField("document", document, "company")
    : undefined;

  const validationErrors = validateFields(
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

  const company = await createCompany({
    name: stdName!,
    document: stdDocument!,
    documentType: documentType ?? "cnpj",
    billingAddress: billingAddress ?? {},
    ownerId: ctx.claims?.actorId ?? "0",
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
