import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { updateCache } from "@/server/utils/cache";

const defaultSection = () => ({
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  permissions: [],
});

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const db = await getDb();
  let query = "SELECT * FROM file_access";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("name @@ $search");
    bindings.search = search;
  }

  if (cursor) {
    conditions.push("id < $cursor");
    bindings.cursor = cursor;
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return Response.json({
    success: true,
    data,
    nextCursor: hasMore && data.length > 0
      ? data[data.length - 1]?.id ?? null
      : null,
  });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, categoryPattern, download, upload } = body;

  const nameErrors = validateField("name", name);
  if (nameErrors.length > 0 || !name) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: nameErrors.length > 0
            ? nameErrors
            : ["validation.name.required"],
        },
      },
      { status: 400 },
    );
  }

  if (!categoryPattern || typeof categoryPattern !== "string") {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.field.required"],
        },
      },
      { status: 400 },
    );
  }

  const sanitizedPattern = categoryPattern.trim().replace(/<>/g, "");
  if (!sanitizedPattern) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.field.required"],
        },
      },
      { status: 400 },
    );
  }

  const dupCheck = await checkDuplicates("file_access", [
    { field: "name", value: standardizeField("name", sanitizeString(name)) },
  ]);
  if (dupCheck.isDuplicate) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.name.duplicate"],
        },
      },
      { status: 409 },
    );
  }

  try {
    const db = await getDb();
    const result = await db.query<[Record<string, unknown>[]]>(
      `CREATE file_access SET
        name = $name,
        categoryPattern = $categoryPattern,
        download = $download,
        upload = $upload`,
      {
        name: standardizeField("name", sanitizeString(name)),
        categoryPattern: sanitizedPattern,
        download: download ?? defaultSection(),
        upload: upload ?? defaultSection(),
      },
    );

    await updateCache("core", "file-access");

    return Response.json(
      { success: true, data: result[0]?.[0] },
      { status: 201 },
    );
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id, name, categoryPattern, download, upload } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const sets: string[] = [];
    const bindings: Record<string, unknown> = { id: rid(String(id)) };

    if (name !== undefined) {
      sets.push("name = $name");
      bindings.name = standardizeField("name", sanitizeString(name));
    }
    if (categoryPattern !== undefined) {
      sets.push("categoryPattern = $categoryPattern");
      bindings.categoryPattern = categoryPattern;
    }
    if (download !== undefined) {
      sets.push("download = $download");
      bindings.download = download;
    }
    if (upload !== undefined) {
      sets.push("upload = $upload");
      bindings.upload = upload;
    }

    if (sets.length === 0) {
      return Response.json({ success: true, data: null });
    }

    const result = await db.query<[Record<string, unknown>[]]>(
      `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
      bindings,
    );

    await updateCache("core", "file-access");

    return Response.json({ success: true, data: result[0]?.[0] });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  let id: string | undefined = url.searchParams.get("id") ?? undefined;

  if (!id) {
    try {
      const body = await req.json();
      id = body.id;
    } catch {}
  }

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await db.query("DELETE $id", { id: rid(id) });

    await updateCache("core", "file-access");

    return Response.json({ success: true });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
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
