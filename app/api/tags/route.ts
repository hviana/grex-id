import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import {
  createTag,
  deleteTag,
  listTags,
  searchTags,
  updateTag,
} from "@/server/db/queries/tags";

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
    const search = url.searchParams.get("search");

    if (search) {
      const tags = await searchTags(ctx.companyId, ctx.systemId, search);
      return NextResponse.json({ success: true, data: tags });
    }

    const tags = await listTags(ctx.companyId, ctx.systemId);
    return NextResponse.json({ success: true, data: tags });
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
    const name = body.name
      ? standardizeField("name", body.name, "tag")
      : undefined;
    const color = body.color?.trim() ?? "";

    const nameErrors = validateField("name", name, "tag");
    if (nameErrors.length > 0) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION", errors: nameErrors } },
        { status: 400 },
      );
    }

    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.color.invalid"],
          },
        },
        { status: 400 },
      );
    }

    const dup = await checkDuplicates("tag", [
      { field: "name", value: name },
    ]);
    if (dup.isDuplicate) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "DUPLICATE", message: "validation.tag.duplicate" },
        },
        { status: 409 },
      );
    }

    const tag = await createTag({
      name: name!,
      color,
      companyId: ctx.companyId,
      systemId: ctx.systemId,
    });

    return NextResponse.json({ success: true, data: tag }, { status: 201 });
  });
}

export async function PUT(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "validation.id.required" },
        },
        { status: 400 },
      );
    }

    const name = body.name
      ? standardizeField("name", body.name, "tag")
      : undefined;
    const color = body.color?.trim();

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["validation.color.invalid"],
          },
        },
        { status: 400 },
      );
    }

    const tag = await updateTag(id, { name, color });
    return NextResponse.json({ success: true, data: tag });
  });
}

export async function DELETE(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return pipeline(req, ctx, async () => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "validation.id.required" },
        },
        { status: 400 },
      );
    }

    await deleteTag(id);
    return NextResponse.json({ success: true });
  });
}
