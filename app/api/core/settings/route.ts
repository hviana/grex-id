import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { listSettings, batchUpsertSettings, deleteSetting } from "@/server/db/queries/core-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import Core from "@/server/utils/Core";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const systemSlug = url.searchParams.get("systemSlug") || undefined;
  const data = await listSettings(systemSlug);
  return Response.json({
    success: true,
    data,
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { settings, systemSlug } = body;

  if (!Array.isArray(settings)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.settings.arrayRequired"],
        },
      },
      { status: 400 },
    );
  }

  const items = settings
    .filter((s: Record<string, unknown>) => s.key)
    .map((s: Record<string, unknown>) => ({
      key: standardizeField("name", String(s.key ?? "")),
      value: standardizeField("name", String(s.value ?? "")),
      description: standardizeField("name", String(s.description ?? "")),
      systemSlug: systemSlug || undefined,
    }));

  await batchUpsertSettings(items);
  await Core.getInstance().reload();

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { key, systemSlug } = body;
  if (!key) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.settings.keyRequired"],
        },
      },
      { status: 400 },
    );
  }
  await deleteSetting(key, systemSlug || undefined);
  await Core.getInstance().reload();
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  getHandler,
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
