import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { checkDuplicates } from "@/server/utils/entity-deduplicator";
import { updateTenantCache } from "@/server/utils/cache";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";

const defaultSection = () => ({
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  roles: [],
});

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const result = await genericList({
    table: "file_access",
    searchFields: ["name"],
    search,
    cursor,
    limit,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
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
    const createResult = await genericCreate(
      {
        table: "file_access",
        fields: [
          { field: "name", unique: true },
          { field: "categoryPattern" },
          { field: "download" },
          { field: "upload" },
        ],
      },
      {
        name: sanitizedName,
        categoryPattern: sanitizedPattern,
        download: download ?? defaultSection(),
        upload: upload ?? defaultSection(),
      },
    );
    const rule = createResult.data;

    updateTenantCache(undefined, "file-access");

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
  const { body, error } = await parseBody(req);
  if (error) return error;
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
    const data: Record<string, unknown> = {};

    if (name !== undefined) data.name = name;
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
      data.categoryPattern = sanitized;
    }
    if (download !== undefined) data.download = download;
    if (upload !== undefined) data.upload = upload;

    if (Object.keys(data).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate(
      {
        table: "file_access",
        fields: [
          { field: "name", unique: true },
          { field: "categoryPattern" },
          { field: "download" },
          { field: "upload" },
        ],
      },
      id,
      data,
    );

    if (!result.success) {
      if (result.duplicateFields?.length) {
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
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    updateTenantCache(undefined, "file-access");

    return Response.json({ success: true, data: result.data });
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
    await genericDelete({ table: "file_access" }, id);

    updateTenantCache(undefined, "file-access");

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
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  deleteHandler,
);
