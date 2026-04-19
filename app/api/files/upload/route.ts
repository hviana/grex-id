import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import type { SaveControlResult } from "@hviana/surreal-fs";
import Core from "@/server/utils/Core";
import FileCacheManager from "@/server/utils/file-cache";
import { resolveFileCacheLimit } from "@/server/utils/guards";

const MB = 1048576;

export const POST = compose(
  withAuth(),
  async (req: Request, ctx: RequestContext): Promise<Response> => {
    const formData = await req.formData();
    const file = formData.get("file");
    const systemSlug = formData.get("systemSlug") as string | null;
    const categoryRaw = formData.get("category") as string | null;
    const fileUuid = formData.get("fileUuid") as string | null;
    const description = formData.get("description") as string | null;

    if (!file || !(file instanceof Blob)) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["files.upload.fileRequired"] },
        },
        { status: 400 },
      );
    }
    if (!systemSlug || !categoryRaw || !fileUuid) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["files.upload.missingFields"],
          },
        },
        { status: 400 },
      );
    }

    let category: string[];
    try {
      category = JSON.parse(categoryRaw);
      if (!Array.isArray(category)) throw new Error();
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: ["files.upload.invalidCategory"],
          },
        },
        { status: 400 },
      );
    }

    // Resolve companyId and userId directly from tenant (§9, §13.2)
    const companyId = ctx.tenant.companyId;
    const userId = ctx.claims?.actorId ?? "0";

    const fileName = file.name || "unnamed";
    const mimeType = file.type || "application/octet-stream";
    const path = [
      companyId,
      systemSlug,
      userId,
      ...category,
      fileUuid,
      fileName,
    ];

    const metadata: Record<string, unknown> = {
      companyId,
      systemSlug,
      userId,
      category,
      fileName,
      fileUuid,
      mimeType,
    };
    if (description) metadata.description = description;

    const fs = await getFS();
    const result = await fs.save({
      path,
      content: file.stream(),
      metadata,
      control: (_path, _concurrencyMap): SaveControlResult => ({
        accessAllowed: true,
        kbytesPerSecond: 16384,
        concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
        maxFileSizeBytes: 50 * MB,
        allowedExtensions: [],
      }),
    });

    if ("status" in result && result.status === "error") {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "files.upload.failed" },
        },
        { status: 500 },
      );
    }

    // Cache invalidation on replacement (§13.2 step 7)
    const uri = fs.pathToURIComponent(path);
    let cacheTenantKey = "core";
    const core = Core.getInstance();
    const system = await core.getSystemBySlug(systemSlug);
    if (system) {
      const limit = await resolveFileCacheLimit({
        companyId,
        systemId: system.id,
      });
      if (limit.maxBytes > 0) {
        cacheTenantKey = `${companyId}:${systemSlug}`;
      }
    }
    FileCacheManager.getInstance().evict(cacheTenantKey, uri);

    return Response.json({
      success: true,
      data: {
        uri,
        fileUuid,
        fileName,
        sizeBytes: "size" in result ? (result as any).size : 0,
        mimeType,
      },
    });
  },
);
