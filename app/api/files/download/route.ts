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
import { checkFileAccess } from "@/server/utils/file-access-guard";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant";
import { verifyTenantToken, hashToken } from "@/server/utils/token";
import { findTokenByHash } from "@/server/db/queries/tokens";
import { isJtiRevoked } from "@/server/utils/token-revocation";
import { getAnonymousTenant } from "@/server/utils/tenant";

const DEFAULT_MIME = "application/octet-stream";
const pendingInsertions = new Set<string>();

async function resolveTokenParam(
  tokenStr: string,
): Promise<{ tenant: Tenant; claims?: TenantClaims } | null> {
  try {
    if (tokenStr.split(".").length === 3) {
      const claims = await verifyTenantToken(tokenStr);
      if (claims.jti && (await isJtiRevoked(claims.jti))) return null;
      return {
        tenant: {
          systemId: claims.systemId,
          companyId: claims.companyId,
          systemSlug: claims.systemSlug,
          roles: claims.roles,
          permissions: claims.permissions,
        },
        claims,
      };
    }

    const tokenHash = await hashToken(tokenStr);
    const apiToken = await findTokenByHash(tokenHash);
    if (!apiToken || apiToken.revokedAt) return null;
    if (
      !apiToken.neverExpires &&
      apiToken.expiresAt &&
      new Date(apiToken.expiresAt).getTime() <= Date.now()
    ) return null;

    const tenant: Tenant = apiToken.tenant ?? {
      systemId: String(apiToken.systemId),
      companyId: String(apiToken.companyId),
      systemSlug: "",
      roles: [],
      permissions: apiToken.permissions ?? [],
    };
    const claims: TenantClaims = {
      ...tenant,
      actorType: "api_token",
      actorId: String(apiToken.id),
      jti: apiToken.jti ?? "",
      exchangeable: false,
    };
    return { tenant, claims };
  } catch {
    return null;
  }
}

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

    const fileCompanyId = path[0];
    const fileSystemSlug = path[1];
    const fileUserId = path[2] ?? "0";
    const fileCategory = path.slice(3, path.length - 2);

    // Resolve effective tenant — from query param token or middleware context
    const tokenParam = url.searchParams.get("token");
    let effectiveTenant = ctx.tenant;
    let effectiveClaims = ctx.claims;

    if (tokenParam) {
      const resolved = await resolveTokenParam(tokenParam);
      if (resolved) {
        effectiveTenant = resolved.tenant;
        effectiveClaims = resolved.claims;
      } else {
        effectiveTenant = getAnonymousTenant(fileSystemSlug);
        effectiveClaims = undefined;
      }
    }

    // File access control guard
    const accessCheck = await checkFileAccess({
      categoryPath: fileCategory,
      fileCompanyId,
      fileSystemSlug,
      fileUserId,
      tenant: effectiveTenant,
      claims: effectiveClaims,
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

    // Resolve cache context (§13.3, §13.6)
    const core = Core.getInstance();
    const hitWindowMs =
      Number((await core.getSetting("cache.file.hitWindowHours")) || "1") *
      3600000;
    let cacheTenantKey = "core";
    let cacheMaxSize =
      Number((await core.getSetting("cache.core.size")) || "20") * 1048576;

    const system = await core.getSystemBySlug(fileSystemSlug);
    if (system) {
      const limit = await resolveFileCacheLimit({
        companyId: fileCompanyId,
        systemId: system.id,
      });
      if (limit.maxBytes > 0) {
        cacheTenantKey = `${fileCompanyId}:${fileSystemSlug}`;
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
        resolveMaxConcurrentDownloads({ companyId: fileCompanyId, systemId }),
        resolveMaxDownloadBandwidth({ companyId: fileCompanyId, systemId }),
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
    const file = await fs.read({
      path,
      control: (_path, concurrencyMap): ReadControlResult => {
        const userDownloads = concurrencyMap[fileUserId] ?? 0;
        if (
          resolvedMaxConcurrent > 0 && userDownloads >= resolvedMaxConcurrent
        ) {
          return {
            accessAllowed: false,
            concurrencyIdentifiers: [fileCompanyId, `${fileCompanyId}/${fileSystemSlug}`],
          };
        }

        const tenantDownloads = concurrencyMap[`${fileCompanyId}/${fileSystemSlug}`] ??
          1;
        const kbytesPerSecond = resolvedMaxBWMB > 0
          ? Math.floor((resolvedMaxBWMB * 1024) / tenantDownloads)
          : 16384;

        return {
          accessAllowed: true,
          kbytesPerSecond,
          concurrencyIdentifiers: [fileCompanyId, `${fileCompanyId}/${fileSystemSlug}`],
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
