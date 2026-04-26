import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  batchUpsertSettings,
  deleteSetting,
  listSettings,
} from "@/server/db/queries/core-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import Core from "@/server/utils/Core";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") || undefined;
  const data = await listSettings(tenantId);
  return Response.json({
    success: true,
    data,
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { settings, tenantId } = body;

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

  const items: {
    key: string;
    value: string;
    description: string;
    tenantId?: string;
  }[] = [];
  for (const s of settings.filter((s: Record<string, unknown>) => s.key)) {
    items.push({
      key: await standardizeField("name", String(s.key ?? "")),
      value: await standardizeField("name", String(s.value ?? "")),
      description: await standardizeField("name", String(s.description ?? "")),
      tenantId: tenantId || undefined,
    });
  }

  await batchUpsertSettings(items);
  await Core.getInstance().reload();

  return Response.json({ success: true });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { key, tenantId } = body;
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
  await deleteSetting(key, tenantId || undefined);
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
