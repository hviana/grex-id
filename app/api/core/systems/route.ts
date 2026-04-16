import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  createSystem,
  deleteSystem,
  listSystems,
  updateSystem,
} from "@/server/db/queries/systems";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const result = await listSystems({ search, cursor, limit });
  return Response.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, slug, logoUri, termsOfService } = body;

  const nameErrors = validateField("name", name);
  const slugErrors = validateField("slug", slug);
  const allErrors = [...nameErrors, ...slugErrors];

  if (allErrors.length > 0) {
    return Response.json(
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

  await Core.getInstance().reload();

  return Response.json({ success: true, data: system }, { status: 201 });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id, name, slug, logoUri, termsOfService } = body;

  if (!id) {
    return Response.json(
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
    return Response.json(
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

  await Core.getInstance().reload();

  return Response.json({ success: true, data: system });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  await deleteSystem(id);

  await Core.getInstance().reload();

  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  getHandler,
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  postHandler,
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  putHandler,
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  deleteHandler,
);
