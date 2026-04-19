import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import type { SaveControlResult } from "@hviana/surreal-fs";
import Core from "@/server/utils/Core";

const PUBLIC_MAX_SIZE_BYTES = 2_097_152; // 2 MB
const AUTH_MAX_SIZE_BYTES = 52_428_800; // 50 MB

function matchesGlob(pathSegments: string[], pattern: string): boolean {
  const patternParts = pattern.split("/");
  if (patternParts.length > pathSegments.length) return false;
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === "*") continue;
    if (patternParts[i] !== pathSegments[i]) return false;
  }
  return true;
}

function isPathAllowed(
  pathSegments: string[],
  patterns: string[],
): boolean {
  return patterns.some((p) => matchesGlob(pathSegments, p));
}

/**
 * Two-tier upload handler (§13.2).
 * - Authenticated: token present, file stored under tenant path (or superuser defaults).
 * - Unauthenticated: no token, strict path/extension/size validation.
 */
async function postHandler(req: Request, ctx: RequestContext) {
  const isAuthenticated = ctx.claims !== undefined;
  const isSuperuser = ctx.tenant.roles.includes("superuser");
  const isSuperuserWithoutTenant = isAuthenticated && isSuperuser &&
    ctx.tenant.companyId === "0";

  // Unauthenticated: strict per-IP rate limit
  if (!isAuthenticated) {
    const core = Core.getInstance();
    const publicRateLimit = Number(
      (await core.getSetting("files.publicUpload.rateLimit.perMinute")) ?? "3",
    );
    const rateResult = await new Promise<Response | null>((resolve) => {
      const rateLimitMiddleware = withRateLimit({
        windowMs: 60_000,
        maxRequests: publicRateLimit,
      });
      rateLimitMiddleware(req, ctx, async () => {
        resolve(null);
        return new Response(null);
      }).then((res) => {
        if (res.status === 429) resolve(res);
      });
    });
    if (rateResult) return rateResult;
  }

  const formData = await req.formData();
  const fileEntry = formData.get("file");
  const formCompanyId = (formData.get("companyId") as string | null) || "";
  const formSystemSlug = formData.get("systemSlug") as string | null;
  const formUserId = (formData.get("userId") as string | null) || "";
  const categoryRaw = formData.get("category") as string | null;
  const description = formData.get("description") as string | null;

  let category: string[] | null = null;
  if (categoryRaw) {
    try {
      const parsed = JSON.parse(categoryRaw);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((s: unknown) => typeof s === "string")
      ) {
        category = parsed;
      }
    } catch {
      // invalid JSON
    }
  }

  // companyId, systemSlug, and category are always required
  if (!(fileEntry instanceof File) || !formSystemSlug || !category) {
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

  // Resolve companyId, systemSlug, userId based on tier
  let companyId: string;
  let systemSlug: string;
  let userId: string;

  if (isAuthenticated) {
    if (isSuperuserWithoutTenant) {
      companyId = formCompanyId || "core";
      userId = formUserId || "superuser";
    } else {
      companyId = ctx.tenant.companyId;
      userId = ctx.claims!.actorId;
    }
    systemSlug = formSystemSlug;
  } else {
    // Unauthenticated: all fields from FormData, userId defaults to "anonymous"
    if (!formCompanyId) {
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
    companyId = formCompanyId;
    systemSlug = formSystemSlug;
    userId = formUserId || "anonymous";
  }

  const fileUuid = crypto.randomUUID();
  const fileName = fileEntry.name;
  const mimeType = fileEntry.type || "application/octet-stream";
  const path = [companyId, systemSlug, userId, ...category, fileUuid, fileName];

  const fs = await getFS();

  const metadata = {
    companyId,
    systemSlug,
    userId,
    category,
    fileName,
    fileUuid,
    mimeType,
    description: description || undefined,
  };

  // Resolve size limit for authenticated uploads
  let maxSizeBytes = AUTH_MAX_SIZE_BYTES;
  if (isAuthenticated) {
    const core = Core.getInstance();
    try {
      const sizeSetting = await core.getSetting(
        "files.maxUploadSizeBytes",
        systemSlug,
      );
      if (sizeSetting) maxSizeBytes = Number(sizeSetting);
    } catch { /* use defaults */ }
  }

  // Resolve public upload settings for unauthenticated uploads
  let publicAllowedExtensions = ["svg", "png", "jpg", "jpeg", "webp"];
  let publicAllowedPathPatterns = ["*/*/*/logos/*", "*/*/*/avatars/*"];
  let publicMaxSizeBytes = PUBLIC_MAX_SIZE_BYTES;

  if (!isAuthenticated) {
    const core = Core.getInstance();
    try {
      const extSetting = await core.getSetting(
        "files.publicUpload.allowedExtensions",
      );
      if (extSetting) publicAllowedExtensions = JSON.parse(extSetting);
    } catch { /* use defaults */ }
    try {
      const patternSetting = await core.getSetting(
        "files.publicUpload.allowedPathPatterns",
      );
      if (patternSetting) {
        publicAllowedPathPatterns = JSON.parse(patternSetting);
      }
    } catch { /* use defaults */ }
    try {
      const sizeSetting = await core.getSetting(
        "files.publicUpload.maxSizeBytes",
      );
      if (sizeSetting) publicMaxSizeBytes = Number(sizeSetting);
    } catch { /* use defaults */ }
  }

  const control = (
    savePath: string[],
    _concurrencyMap: Record<string, number | undefined>,
  ): SaveControlResult => {
    if (!isAuthenticated) {
      return {
        accessAllowed: isPathAllowed(savePath, publicAllowedPathPatterns),
        maxFileSizeBytes: publicMaxSizeBytes,
        allowedExtensions: publicAllowedExtensions,
        concurrencyIdentifiers: [savePath.slice(0, 3).join("/")],
        kbytesPerSecond: 10,
      };
    }
    return {
      accessAllowed: true,
      maxFileSizeBytes: maxSizeBytes,
      allowedExtensions: [],
      concurrencyIdentifiers: [savePath.slice(0, 3).join("/")],
    };
  };

  const result = await fs.save({
    path,
    content: fileEntry.stream(),
    metadata,
    control,
  });

  if ("status" in result) {
    const status = result.status;
    if (status === "error") {
      const msg = result.msg ?? "";
      if (msg.includes("extension")) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "common.error.file.invalidExtension",
            },
          },
          { status: 400 },
        );
      }
      if (msg.includes("size") || msg.includes("Size")) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "common.error.file.tooLarge",
            },
          },
          { status: 400 },
        );
      }
      if (msg.includes("access") || msg.includes("Access")) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "common.error.file.pathNotAllowed",
            },
          },
          { status: 403 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "UPLOAD_FAILED",
            message: "common.error.file.uploadFailed",
          },
        },
        { status: 500 },
      );
    }
    // saving / deleting in progress
    return Response.json(
      {
        success: false,
        error: {
          code: "UPLOAD_FAILED",
          message: "common.error.file.uploadFailed",
        },
      },
      { status: 500 },
    );
  }

  const uri = path.join("/");

  return Response.json(
    {
      success: true,
      data: { uri, fileUuid, fileName, sizeBytes: result.size, mimeType },
    },
    { status: 201 },
  );
}

// withAuth synthesizes an anonymous tenant for unauthenticated requests,
// allowing the handler to differentiate based on ctx.claims presence.
export const POST = compose(
  withAuth(),
  async (req, ctx) => postHandler(req, ctx),
);
