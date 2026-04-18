import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { listFrontSettings, upsertFrontSetting, deleteFrontSetting } from "@/server/db/queries/front-settings";
import { standardizeField } from "@/server/utils/field-standardizer";
import FrontCore from "@/server/utils/FrontCore";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const systemSlug = url.searchParams.get("systemSlug") || undefined;
  const frontCore = FrontCore.getInstance();
  await frontCore.load();

  let settings: { id: string; key: string; value: string; description: string; systemSlug?: string }[];

  if (systemSlug) {
    settings = (await listFrontSettings(systemSlug)).map((s) => ({
      id: s.id,
      key: s.key,
      value: s.value,
      description: s.description ?? "",
      systemSlug: s.systemSlug,
    }));
  } else {
    settings = [];
    for (const [, setting] of frontCore.settings) {
      if (!setting.systemSlug) {
        settings.push({
          id: setting.id,
          key: setting.key,
          value: setting.value,
          description: setting.description ?? "",
        });
      }
    }
  }

  const missing = await frontCore.getMissingSettings();

  return Response.json({
    success: true,
    data: { settings, missing },
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { settings, systemSlug } = body as {
    settings: { key: string; value: string; description?: string }[];
    systemSlug?: string;
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

  for (const s of settings) {
    if (!s.key) continue;
    await upsertFrontSetting({
      key: standardizeField("name", s.key),
      value: s.value ?? "",
      description: s.description ?? "",
      systemSlug: systemSlug || undefined,
    });
  }

  await FrontCore.getInstance().reload();

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
  await deleteFrontSetting(key, systemSlug || undefined);
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
