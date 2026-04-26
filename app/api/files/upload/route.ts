import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import type { SaveControlResult } from "@hviana/surreal-fs";
import Core from "@/server/utils/Core";
import FileCacheManager from "@/server/utils/file-cache";
import {
  resolveFileCacheLimit,
  resolveMaxConcurrentUploads,
  resolveMaxUploadBandwidth,
} from "@/server/utils/guards";
import { checkFileAccess } from "@/server/utils/file-access-guard";

const MB = 1048576;
const activeUploads = new Map<string, number>();

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
          error: { code: "VALIDATION", errors: ["files.upload.missingFields"] },
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

    const companyId = ctx.tenant.companyId;
    const userId = ctx.tenant.actorId!;
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

    const accessCheck = await checkFileAccess({
      categoryPath: category,
      fileCompanyId: companyId,
      fileSystemSlug: systemSlug,
      fileUserId: userId,
      tenant: ctx.tenant,
      operation: "upload",
    });
    if (!accessCheck.allowed) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "files.upload.accessDenied" },
        },
        { status: 403 },
      );
    }

    if (
      accessCheck.allowedExtensions && accessCheck.allowedExtensions.length > 0
    ) {
      const ext = fileName.includes(".")
        ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
        : "";
      if (!ext || !accessCheck.allowedExtensions.includes(ext)) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              errors: ["files.upload.extensionNotAllowed"],
            },
          },
          { status: 400 },
        );
      }
    }

    if (
      accessCheck.maxFileSizeBytes && file.size > accessCheck.maxFileSizeBytes
    ) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["files.upload.fileTooLarge"] },
        },
        { status: 400 },
      );
    }

    const core = Core.getInstance();
    const system = await core.getSystemBySlug(systemSlug);
    const systemId = system?.id ?? "";
    const hasSubscription = companyId && systemId;
    const [uploadLimits, bwLimits, defaultConcurrent, defaultBW] =
      hasSubscription
        ? await Promise.all([
          resolveMaxConcurrentUploads({ tenant: ctx.tenant }),
          resolveMaxUploadBandwidth({ tenant: ctx.tenant }),
          core.getSetting("transfer.default.maxConcurrentUploads"),
          core.getSetting("transfer.default.maxUploadBandwidthMB"),
        ])
        : [
          { max: 0, planLimit: 0, voucherModifier: 0 },
          { max: 0, planLimit: 0, voucherModifier: 0 },
          undefined,
          undefined,
        ];

    const maxConcurrent = uploadLimits.max || Number(defaultConcurrent) || 0;
    const maxBWMB = bwLimits.max || Number(defaultBW) || 0;
    const concurrencyKey = `${companyId}/${systemSlug}`;

    const current = activeUploads.get(concurrencyKey) ?? 0;
    if (maxConcurrent > 0 && current >= maxConcurrent) {
      return Response.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "files.upload.concurrentLimit",
          },
        },
        { status: 429 },
      );
    }

    activeUploads.set(concurrencyKey, current + 1);
    try {
      const fs = await getFS();
      const result = await fs.save({
        path,
        content: file.stream(),
        metadata,
        control: (_path, concurrencyMap): SaveControlResult => {
          const tenantUploads = concurrencyMap[concurrencyKey] ?? 1;
          return {
            kbytesPerSecond: maxBWMB > 0
              ? Math.floor((maxBWMB * 1024) / tenantUploads)
              : 16384,
            concurrencyIdentifiers: [companyId, concurrencyKey],
            maxFileSizeBytes: accessCheck.maxFileSizeBytes ?? 50 * MB,
            allowedExtensions: accessCheck.allowedExtensions ?? [],
          };
        },
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

      const uri = fs.pathToURIComponent(path);
      let cacheTenantKey = "core";
      if (system && companyId) {
        const limit = await resolveFileCacheLimit({
          tenant: ctx.tenant,
        });
        if (limit.maxBytes > 0) cacheTenantKey = `${companyId}:${systemSlug}`;
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
    } finally {
      const remaining = (activeUploads.get(concurrencyKey) ?? 1) - 1;
      if (remaining <= 0) activeUploads.delete(concurrencyKey);
      else activeUploads.set(concurrencyKey, remaining);
    }
  },
);
