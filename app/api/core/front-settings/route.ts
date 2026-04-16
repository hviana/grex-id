import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb } from "@/server/db/connection";
import { standardizeField } from "@/server/utils/field-standardizer";
import FrontCore from "@/server/utils/FrontCore";

async function getHandler(_req: Request, _ctx: RequestContext) {
  const frontCore = FrontCore.getInstance();
  await frontCore.load();

  const settings: {
    id: string;
    key: string;
    value: string;
    description: string;
  }[] = [];
  for (const [, setting] of frontCore.settings) {
    settings.push({
      id: setting.id,
      key: setting.key,
      value: setting.value,
      description: setting.description ?? "",
    });
  }

  const missing = await frontCore.getMissingSettings();

  return Response.json({
    success: true,
    data: { settings, missing },
  });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { settings } = body as {
    settings: { key: string; value: string; description?: string }[];
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

  const db = await getDb();

  for (const s of settings) {
    if (!s.key) continue;
    await db.query(
      `UPSERT front_core_setting SET
        key = $key,
        value = $value,
        description = $description,
        updatedAt = time::now()
      WHERE key = $key`,
      {
        key: standardizeField("name", s.key),
        value: s.value ?? "",
        description: s.description ?? "",
      },
    );
  }

  // Reload FrontCore cache
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
