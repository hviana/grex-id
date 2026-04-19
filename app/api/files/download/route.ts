import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import { type ReadControlResult, SurrealFS } from "@hviana/surreal-fs";
import FileCacheManager from "@/server/utils/file-cache";
import {
  resolveFileCacheLimit,
  resolveMaxConcurrentDownloads,
  resolveMaxDownloadBandwidth,
} from "@/server/utils/guards";
import Core from "@/server/utils/Core";

const DEFAULT_MIME = "application/octet-stream";
const pendingInsertions = new Set<string>();

export const GET = compose(
  withAuth(),
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

    const companyId = path[0];
    const systemSlug = path[1];

    // Resolve cache context (§13.3, §13.6)
    const core = Core.getInstance();
    const hitWindowMs =
      Number((await core.getSetting("cache.file.hitWindowHours")) || "1") *
      3600000;
    let cacheTenantKey = "core";
    let cacheMaxSize =
      Number((await core.getSetting("cache.core.size")) || "20") * 1048576;

    const system = await core.getSystemBySlug(systemSlug);
    if (system) {
      const limit = await resolveFileCacheLimit({
        companyId,
        systemId: system.id,
      });
      if (limit.maxBytes > 0) {
        cacheTenantKey = `${companyId}:${systemSlug}`;
        cacheMaxSize = limit.maxBytes;
      }
    }

    // Cache HIT — skip SurrealFS entirely
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
        return new Response(probe.data, {
          headers: {
            "Content-Type": probe.mimeType || DEFAULT_MIME,
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Content-Length": String(probe.data.byteLength),
          },
        });
      }
    }

    // Resolve transfer limits from plan + voucher + Core settings (§13.3)
    const systemId = system?.id ?? "";
    const [dlLimits, bwLimits, defaultConcurrent, defaultBW] = systemId
      ? await Promise.all([
        resolveMaxConcurrentDownloads({ companyId, systemId }),
        resolveMaxDownloadBandwidth({ companyId, systemId }),
        core.getSetting("transfer.default.maxConcurrentDownloads"),
        core.getSetting("transfer.default.maxDownloadBandwidthMB"),
      ])
      : [
        { max: 0, planLimit: 0, voucherModifier: 0 },
        { max: 0, planLimit: 0, voucherModifier: 0 },
        undefined,
        undefined,
      ];

    const resolvedMaxConcurrent = dlLimits.max || Number(defaultConcurrent) ||
      0;
    const resolvedMaxBWMB = bwLimits.max || Number(defaultBW) || 0;

    // Read from SurrealFS with control callback
    const userId = path[2] ?? "0";
    const file = await fs.read({
      path,
      control: (_path, concurrencyMap): ReadControlResult => {
        const userDownloads = concurrencyMap[userId] ?? 0;
        if (
          resolvedMaxConcurrent > 0 && userDownloads >= resolvedMaxConcurrent
        ) {
          return {
            accessAllowed: false,
            concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
          };
        }

        const tenantDownloads = concurrencyMap[`${companyId}/${systemSlug}`] ??
          1;
        const kbytesPerSecond = resolvedMaxBWMB > 0
          ? Math.floor((resolvedMaxBWMB * 1024) / tenantDownloads)
          : 16384;

        return {
          accessAllowed: true,
          kbytesPerSecond,
          concurrencyIdentifiers: [companyId, `${companyId}/${systemSlug}`],
        };
      },
    });

    if (
      !file || ("status" in file && file.status !== "complete") || !file.content
    ) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "files.download.notFound" },
        },
        { status: 404 },
      );
    }

    const fileName = (file.metadata?.fileName as string) ||
      path[path.length - 1];
    const mimeType = (file.metadata?.mimeType as string) || DEFAULT_MIME;
    const fileSize = file.size;
    const headers: Record<string, string> = {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(fileSize),
    };

    // Background cache insertion (non-blocking, deduplicated — §13.3 step 7)
    if (
      cacheMaxSize > 0 && fileSize <= cacheMaxSize &&
      !pendingInsertions.has(uri)
    ) {
      pendingInsertions.add(uri);
      const cache = FileCacheManager.getInstance();
      const [clientStream, cacheStream] = file.content.tee();

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
          // Cache insertion failure is non-fatal
        } finally {
          pendingInsertions.delete(uri);
        }
      })();

      return new Response(clientStream, { headers });
    }

    return new Response(file.content, { headers });
  },
);
