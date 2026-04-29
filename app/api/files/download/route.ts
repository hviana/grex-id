import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { getFS } from "@/server/utils/fs";
import {
  type File as SFSFile,
  type ReadControlResult,
  SurrealFS,
} from "@hviana/surreal-fs";
import FileCacheManager from "@/server/utils/file-cache";
import {
  resolveFileCacheLimit,
  resolveMaxConcurrentDownloads,
  resolveMaxDownloadBandwidth,
} from "@/server/utils/guards";
import Core from "@/server/utils/Core";
import { checkFileAccess } from "@/server/utils/file-access-guard";
import type { Tenant } from "@/src/contracts/tenant";
import { verifyTenantToken } from "@/server/utils/token";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "@/server/utils/actor-validity";

const DEFAULT_MIME = "application/octet-stream";
const pendingInsertions = new Set<string>();
const activeDownloads = new Map<string, number>();

async function resolveTokenParam(
  tokenStr: string,
): Promise<{ tenant: Tenant } | null> {
  try {
    const { tenant } = await verifyTenantToken(tokenStr);
    if (!tenant.actorId) return null;

    await ensureActorValidityLoaded(tenant);
    if (!isActorValid(tenant)) return null;

    return { tenant };
  } catch {
    return null;
  }
}

export const GET = compose(
  withAuthAndLimit({ requireAuthenticated: true }),
  async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const uri = url.searchParams.get("uri");
    if (!uri) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", errors: ["files.download.uriRequired"] },
        },
        { status: 400 },
      );
    }

    const fs = await getFS();
    const path = fs.URIComponentToPath(uri);
    if (path.length < 3) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "files.download.invalidUri" },
        },
        { status: 400 },
      );
    }

    const fileCompanyId = path[0];
    const fileSystemSlug = path[1];
    const fileUserId = path[2] ?? "";
    const fileCategory = path.slice(3, path.length - 2);

    const tokenParam = url.searchParams.get("token");
    let effectiveTenant = ctx.tenantContext?.tenant ?? {};

    if (tokenParam) {
      const resolved = await resolveTokenParam(tokenParam);
      if (resolved) {
        effectiveTenant = resolved.tenant;
      }
    }

    const accessCheck = await checkFileAccess({
      categoryPath: fileCategory,
      fileCompanyId,
      fileSystemSlug,
      fileUserId,
      tenant: effectiveTenant,
      operation: "download",
    });
    if (!accessCheck.allowed) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "files.download.accessDenied" },
        },
        { status: 403 },
      );
    }

    const core = Core.getInstance();
    const hitWindowMs =
      Number((await core.getSetting("cache.file.hitWindowHours")) || "1") *
      3600000;
    let cacheTenantKey = "core";
    let cacheMaxSize =
      Number((await core.getSetting("cache.core.size")) || "20") * 1048576;

    const system = await core.getSystemBySlug(fileSystemSlug);
    if (system && fileCompanyId) {
      const limit = await resolveFileCacheLimit(effectiveTenant);
      if (limit.maxBytes > 0) {
        cacheTenantKey = `${fileCompanyId}:${fileSystemSlug}`;
        cacheMaxSize = limit.maxBytes;
      }
    }

    if (cacheMaxSize > 0) {
      const cache = FileCacheManager.getInstance();
      const probe = cache.access(
        cacheTenantKey,
        uri,
        0,
        cacheMaxSize,
        undefined,
        hitWindowMs,
      );
      if (probe.hit && probe.data) {
        const fileName = path[path.length - 1];
        return new Response(probe.data.buffer as ArrayBuffer, {
          headers: {
            "Content-Type": probe.mimeType || DEFAULT_MIME,
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Content-Length": String(probe.data.byteLength),
          },
        });
      }
    }

    const [dlLimits, bwLimits, defaultConcurrent, defaultBW] = await Promise
      .all([
        resolveMaxConcurrentDownloads(effectiveTenant),
        resolveMaxDownloadBandwidth(effectiveTenant),
        core.getSetting("transfer.default.maxConcurrentDownloads"),
        core.getSetting("transfer.default.maxDownloadBandwidthMB"),
      ]);

    const maxConcurrent = dlLimits.max || Number(defaultConcurrent) || 0;
    const maxBWMB = bwLimits.max || Number(defaultBW) || 0;
    const concurrencyKey = `${fileCompanyId}/${fileSystemSlug}`;

    const current = activeDownloads.get(concurrencyKey) ?? 0;
    if (maxConcurrent > 0 && current >= maxConcurrent) {
      return Response.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "files.download.concurrentLimit",
          },
        },
        { status: 429 },
      );
    }

    activeDownloads.set(concurrencyKey, current + 1);
    try {
      const file = await fs.read({
        path,
        control: (_path, concurrencyMap): ReadControlResult => {
          const tenantDownloads = concurrencyMap[concurrencyKey] ?? 1;
          return {
            kbytesPerSecond: maxBWMB > 0
              ? Math.floor((maxBWMB * 1024) / tenantDownloads)
              : 16384,
            concurrencyIdentifiers: [fileCompanyId, concurrencyKey],
          };
        },
      });

      if (!file || "status" in file || !("content" in file) || !file.content) {
        return Response.json(
          {
            success: false,
            error: { code: "ERROR", message: "files.download.notFound" },
          },
          { status: 404 },
        );
      }

      const sfsFile = file as SFSFile;
      const fileName = (sfsFile.metadata?.fileName as string) ||
        path[path.length - 1];
      const mimeType = (sfsFile.metadata?.mimeType as string) || DEFAULT_MIME;
      const fileSize = sfsFile.size;
      const headers: Record<string, string> = {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Length": String(fileSize),
      };

      if (
        cacheMaxSize > 0 && fileSize <= cacheMaxSize &&
        !pendingInsertions.has(uri)
      ) {
        pendingInsertions.add(uri);
        const cache = FileCacheManager.getInstance();
        const [clientStream, cacheStream] = sfsFile.content!.tee();

        (async () => {
          try {
            const buffer = await SurrealFS.readStream(cacheStream);
            cache.access(
              cacheTenantKey,
              uri,
              fileSize,
              cacheMaxSize,
              buffer,
              hitWindowMs,
              mimeType,
            );
          } catch {
            // non-fatal
          } finally {
            pendingInsertions.delete(uri);
          }
        })();

        return new Response(clientStream, { headers });
      }

      return new Response(sfsFile.content, { headers });
    } finally {
      const remaining = (activeDownloads.get(concurrencyKey) ?? 1) - 1;
      if (remaining <= 0) activeDownloads.delete(concurrencyKey);
      else activeDownloads.set(concurrencyKey, remaining);
    }
  },
);
