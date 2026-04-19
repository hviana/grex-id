import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import type { ReadControlResult } from "@hviana/surreal-fs";
import FileCacheManager from "@/server/utils/file-cache";
import { resolveFileCacheLimit } from "@/server/utils/guards";
import Core from "@/server/utils/Core";

async function resolveCacheContext(
  companyId: string,
  systemSlug: string,
): Promise<{ tenantKey: string; maxSize: number } | null> {
  const core = Core.getInstance();
  const system = await core.getSystemBySlug(systemSlug);

  if (system?.id) {
    const limit = await resolveFileCacheLimit({
      companyId,
      systemId: String(system.id),
    });
    if (limit.maxBytes > 0) {
      return {
        tenantKey: `${companyId}:${systemSlug}`,
        maxSize: limit.maxBytes,
      };
    }
  }

  const maxSizeStr = await core.getSetting("cache.file.maxSize");
  const maxSize = maxSizeStr ? parseInt(maxSizeStr, 10) : 20971520;
  return maxSize > 0 ? { tenantKey: "core", maxSize } : null;
}

function downloadHeaders(fileName: string, mimeType: string, size: number) {
  return {
    "Content-Type": mimeType,
    "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    "Content-Length": String(size),
    "Cache-Control": "public, max-age=31536000, immutable",
  };
}

function toBytes(content: unknown): Uint8Array | null {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return null;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");

  if (!uri) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "common.error.file.missingFields",
        },
      },
      { status: 400 },
    );
  }

  const path = uri.split("/");
  const companyId = path[0] ?? "";
  const systemSlug = path[1] ?? "";
  const isAuth = ctx.claims !== undefined;
  const cacheMgr = FileCacheManager.getInstance();

  // Resolve cache context (authenticated + tenant-identifiable requests only)
  const cacheCtx = isAuth && companyId && systemSlug
    ? await resolveCacheContext(companyId, systemSlug)
    : null;

  // --- Cache probe (no data, no read) ---
  if (cacheCtx) {
    const probe = cacheMgr.access(cacheCtx.tenantKey, uri, 0, cacheCtx.maxSize);
    if (probe.hit && probe.data) {
      const name = path[path.length - 1];
      return new Response(probe.data, {
        headers: downloadHeaders(
          name,
          "application/octet-stream",
          probe.data.byteLength,
        ),
      });
    }
  }

  // --- Cache miss → read from SurrealFS ---
  const fs = await getFS();
  const file = await fs.read({
    path,
    control: (readPath, _): ReadControlResult => ({
      accessAllowed: true,
      concurrencyIdentifiers: [readPath.slice(0, 3).join("/")],
      ...(!isAuth && { kbytesPerSecond: 10 }),
    }),
  });

  if (!file || !("content" in file) || !file.content) {
    return Response.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.file.notFound" },
      },
      { status: 404 },
    );
  }

  const {
    fileName = path[path.length - 1],
    mimeType = "application/octet-stream",
  } = (file.metadata ?? {}) as Record<string, string>;
  const fileSize = file.size ?? 0;
  const headers = downloadHeaders(fileName, mimeType, fileSize);

  // --- No cache context or empty file → stream directly ---
  if (!cacheCtx || fileSize === 0) {
    return new Response(file.content as BodyInit, { headers });
  }

  const { tenantKey, maxSize } = cacheCtx;

  // --- ReadableStream: tee → client streams now, cache buffers in background ---
  if (file.content instanceof ReadableStream) {
    if (!cacheMgr.shouldCache(tenantKey, fileSize, maxSize)) {
      return new Response(file.content, { headers });
    }
    const [forClient, forCache] = file.content.tee();
    new Response(forCache).arrayBuffer()
      .then((ab) =>
        cacheMgr.access(tenantKey, uri, fileSize, maxSize, new Uint8Array(ab))
      )
      .catch(() => {});
    return new Response(forClient, { headers });
  }

  // --- Buffered content: insert into cache synchronously, then stream ---
  // Cache.access() handles all eviction and churn aging internally.
  const bytes = toBytes(file.content);
  if (bytes) cacheMgr.access(tenantKey, uri, fileSize, maxSize, bytes);

  return new Response(file.content as BodyInit, { headers });
}

export const GET = compose(
  withAuth(),
  async (req, ctx) => getHandler(req, ctx),
);
