import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { listSettings, upsertSetting, deleteSetting } from "@/server/db/queries/core-settings";
import type { CoreSetting } from "@/src/contracts/core-settings";
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

  const results: CoreSetting[] = [];

  for (const setting of settings) {
    const { key, value, description } = setting;

    if (!key) continue;

    const result = await upsertSetting({
      key: standardizeField("name", key),
      value: standardizeField("name", value ?? ""),
      description: standardizeField("name", description ?? ""),
      systemSlug: systemSlug || undefined,
    });
    if (result) results.push(result);
  }

  await Core.getInstance().reload();

  return Response.json({ success: true, data: results });
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
