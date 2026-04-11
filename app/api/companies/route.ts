import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createCompany, listCompanies } from "@/server/db/queries/companies";
import { standardizeField } from "@/server/utils/field-standardizer";

const pipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth(),
);

export async function GET(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") ?? undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "20");

    const result = await listCompanies({ search, cursor, limit });
    return NextResponse.json({
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
    });
  });
}

export async function POST(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
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
      ownerId: ctx.userId,
    });

    return NextResponse.json(
      { success: true, data: company },
      { status: 201 },
    );
  });
}
