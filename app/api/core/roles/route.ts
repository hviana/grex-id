import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { paginatedQuery } from "@/server/db/queries/pagination";
import Core from "@/server/utils/Core";
import { createRole, deleteRole, updateRole } from "@/server/db/queries/roles";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = (url.searchParams.get("direction") as "next" | "prev") ??
    "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  if (search) {
    conditions.push("name @@ $search");
    bindings.search = search;
  }
  if (systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(systemId);
  }

  const result = await paginatedQuery({
    table: "role",
    conditions,
    bindings,
    params: { cursor, limit, direction },
  });

  return Response.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, systemId, permissions, isBuiltIn } = body;

  const errors: string[] = [];
  errors.push(...await validateField("name", name));
  if (!systemId) errors.push("validation.system.required");

  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors },
      },
      { status: 400 },
    );
  }

  try {
    const stdName = await standardizeField("name", sanitizeString(name));
    const dup = await checkDuplicates("role", [
      { field: "name", value: stdName },
      { field: "systemId", value: systemId },
    ]);
    if (dup.isDuplicate) {
      const conflictErrors = dup.conflicts.map((c) =>
        `validation.${c.field}.duplicate`
      );
      return Response.json(
        { success: false, error: { code: "CONFLICT", errors: conflictErrors } },
        { status: 409 },
      );
    }

    const role = await createRole({
      name: stdName,
      systemId,
      permissions: permissions ?? [],
      isBuiltIn: isBuiltIn ?? false,
    });

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: role },
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
  const { id, ...data } = body;

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
    const updates: Partial<
      { name: string; permissions: string[]; isBuiltIn: boolean }
    > = {};

    if (data.name !== undefined) {
      const stdName = await standardizeField("name", sanitizeString(data.name));
      const nameErrors = await validateField("name", stdName);
      if (nameErrors.length > 0) {
        return Response.json(
          { success: false, error: { code: "VALIDATION", errors: nameErrors } },
          { status: 400 },
        );
      }
      updates.name = stdName;
    }
    if (data.permissions !== undefined) {
      updates.permissions = data.permissions;
    }
    if (data.isBuiltIn !== undefined) {
      updates.isBuiltIn = data.isBuiltIn;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const updated = await updateRole(id, updates);

    await Core.getInstance().reload();

    return Response.json({ success: true, data: updated });
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

  try {
    await deleteRole(id);

    await Core.getInstance().reload();

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
