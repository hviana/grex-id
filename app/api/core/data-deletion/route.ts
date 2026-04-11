import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  deleteCompanySystemData,
  verifyUserPassword,
} from "@/server/db/queries/data-deletion";
import { getDb } from "@/server/db/connection";

const pipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 5 }),
  withAuth({ roles: ["superuser"] }),
);

export async function DELETE(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
    const body = await req.json();
    const { companyId, systemId, password } = body;

    if (!companyId || !systemId || !password) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["core.dataDeletion.error.selectBoth"],
          },
        },
        { status: 400 },
      );
    }

    // Verify the superuser's password
    const passwordValid = await verifyUserPassword(ctx.userId, password);
    if (!passwordValid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "core.dataDeletion.error.passwordInvalid",
          },
        },
        { status: 403 },
      );
    }

    // Look up the system slug for file deletion
    const db = await getDb();
    const systemResult = await db.query<[{ slug: string }[]]>(
      "SELECT slug FROM $systemId LIMIT 1",
      { systemId },
    );
    const systemSlug = systemResult[0]?.[0]?.slug;

    if (!systemSlug) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "core.dataDeletion.error.notFound",
          },
        },
        { status: 404 },
      );
    }

    // Verify company exists
    const companyResult = await db.query<[{ id: string }[]]>(
      "SELECT id FROM $companyId LIMIT 1",
      { companyId },
    );
    if (!companyResult[0]?.[0]) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "core.dataDeletion.error.notFound",
          },
        },
        { status: 404 },
      );
    }

    await deleteCompanySystemData(companyId, systemId, systemSlug);

    return NextResponse.json({
      success: true,
      data: { message: "core.dataDeletion.success" },
    });
  });
}
