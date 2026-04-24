import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { updateCache } from "@/server/utils/cache";
import {
  createFileAccessRule,
  deleteFileAccessRule,
  listFileAccessRules,
  updateFileAccessRule,
} from "@/server/db/queries/file-access";

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

  const result = await listFileAccessRules({ search, cursor, limit });

  return Response.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
  });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, categoryPattern, download, upload } = body;

  const nameErrors = await validateField("name", name);
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

  const sanitizedName = await standardizeField("name", sanitizeString(name));

  const dupCheck = await checkDuplicates("file_access", [
    { field: "name", value: sanitizedName },
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
    const rule = await createFileAccessRule({
      name: sanitizedName,
      categoryPattern: sanitizedPattern,
      download: download ?? defaultSection(),
      upload: upload ?? defaultSection(),
    });

    await updateCache("core", "file-access");

    return Response.json(
      { success: true, data: rule },
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
    const sets: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (name !== undefined) {
      const sanitizedName = await standardizeField(
        "name",
        sanitizeString(name),
      );
      const dupCheck = await checkDuplicates("file_access", [
        { field: "name", value: sanitizedName },
      ]);
      if (dupCheck.isDuplicate) {
        const existingId = String(
          dupCheck.conflicts[0]?.existingRecordId ?? "",
        );
        if (existingId !== rid(String(id)).toString()) {
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
      }
      sets.push("name = $name");
      bindings.name = sanitizedName;
    }
    if (categoryPattern !== undefined) {
      const sanitized = String(categoryPattern).trim().replace(/<>/g, "");
      if (!sanitized) {
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
      sets.push("categoryPattern = $categoryPattern");
      bindings.categoryPattern = sanitized;
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

    const updated = await updateFileAccessRule(id, sets, bindings);

    await updateCache("core", "file-access");

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
    await deleteFileAccessRule(id);

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
