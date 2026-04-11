import { NextRequest, NextResponse } from "next/server";
import {
  createSystem,
  deleteSystem,
  listSystems,
  updateSystem,
} from "@/server/db/queries/systems";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const result = await listSystems({ search, cursor, limit });
  return NextResponse.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, slug, logoUri, termsOfService } = body;

  const nameErrors = validateField("name", name);
  const slugErrors = validateField("slug", slug);
  const allErrors = [...nameErrors, ...slugErrors];

  if (allErrors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: allErrors },
      },
      { status: 400 },
    );
  }

  const system = await createSystem({
    name: standardizeField("name", name),
    slug: standardizeField("slug", slug),
    logoUri: logoUri ?? "",
    termsOfService: termsOfService || undefined,
  });

  return NextResponse.json({ success: true, data: system }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, name, slug, logoUri, termsOfService } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  if (name !== undefined) errors.push(...validateField("name", name));
  if (slug !== undefined) errors.push(...validateField("slug", slug));

  if (errors.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors },
      },
      { status: 400 },
    );
  }

  const data: Record<string, string | undefined> = {};
  if (name !== undefined) data.name = standardizeField("name", name);
  if (slug !== undefined) data.slug = standardizeField("slug", slug);
  if (logoUri !== undefined) data.logoUri = logoUri;
  if (termsOfService !== undefined) data.termsOfService = termsOfService;

  const system = await updateSystem(id, data);
  return NextResponse.json({ success: true, data: system });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  await deleteSystem(id);
  return NextResponse.json({ success: true });
}
