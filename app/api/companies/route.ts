import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createCompany, listCompanies } from "@/server/db/queries/companies";
import { standardizeField } from "@/server/utils/field-standardizer";

async function getHandler(req: NextRequest, ctx: RequestContext) {
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
  return NextResponse.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

async function postHandler(req: NextRequest, ctx: RequestContext) {
  const body = await req.json();
  const { name, document, documentType, billingAddress } = body;

  if (!name || !document) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.company.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const company = await createCompany({
    name: standardizeField("name", name, "company"),
    document: standardizeField("document", document, "company"),
    documentType: documentType ?? "cnpj",
    billingAddress: billingAddress ?? {},
    ownerId: ctx.claims?.actorId ?? "0",
  });

  return NextResponse.json(
    { success: true, data: company },
    { status: 201 },
  );
}

export const GET = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, _ctx) => getHandler(req as NextRequest, _ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, _ctx) => postHandler(req as NextRequest, _ctx),
);
