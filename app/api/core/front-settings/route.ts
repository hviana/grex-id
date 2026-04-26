import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  batchUpsertFrontSettings,
  deleteFrontSetting,
  listFrontSettings,
} from "@/server/db/queries/front-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import FrontCore from "@/server/utils/FrontCore";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") || undefined;

  const settings = (await listFrontSettings(tenantId)).map((s) => ({
    id: s.id,
    key: s.key,
    value: s.value,
    description: s.description ?? "",
    tenantIds: s.tenantIds,
  }));

  const missing = await FrontCore.getInstance().getMissingSettings();

  return Response.json({
    success: true,
    data: { settings, missing },
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { settings, tenantId } = body as {
    settings: { key: string; value: string; description?: string }[];
    tenantId?: string;
  };

  if (!settings || !Array.isArray(settings)) {
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
  for (const s of settings.filter((s) => s.key)) {
    items.push({
      key: await standardizeField("name", s.key),
      value: s.value ?? "",
      description: s.description ?? "",
      tenantId: tenantId || undefined,
    });
  }

  await batchUpsertFrontSettings(items);
  await FrontCore.getInstance().reload();

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
  await deleteFrontSetting(key, tenantId || undefined);
  await FrontCore.getInstance().reload();
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
