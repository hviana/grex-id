import { NextRequest } from "next/server";
import { getFS } from "@/server/utils/fs";
import type { SaveControlResult } from "@hviana/surreal-fs";

// --- In-memory rate limiter for unauthenticated uploads ---
const publicUploadLog = new Map<string, number[]>();
const PUBLIC_RATE_LIMIT_PER_MINUTE = 3;
const PUBLIC_MAX_SIZE_BYTES = 2_097_152; // 2 MB
const PUBLIC_ALLOWED_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "webp"];
const PUBLIC_ALLOWED_PATH_PATTERNS = ["*/*/*/logos/*", "*/*/*/avatars/*"];
const AUTH_MAX_SIZE_BYTES = 52_428_800; // 50 MB

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = publicUploadLog.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= PUBLIC_RATE_LIMIT_PER_MINUTE) return true;
  recent.push(now);
  publicUploadLog.set(ip, recent);
  return false;
}

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

async function tryGetAuth(
  req: NextRequest,
): Promise<
  {
    userId: string;
    companyId?: string;
    roles: string[];
  } | null
> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { verifySystemToken } = await import("@/server/utils/token");
    const payload = await verifySystemToken(authHeader.slice(7));
    if (payload?.userId) {
      return {
        userId: payload.userId as string,
        companyId: payload.companyId as string | undefined,
        roles: (payload.roles as string[]) ?? [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown"
  );
}

export async function POST(req: NextRequest) {
  const auth = await tryGetAuth(req);
  const isAuthenticated = auth !== null;
  const isSuperuser = auth?.roles?.includes("superuser") ?? false;

  // Authenticated users are allowed — companyId comes from FormData, not the token

  // Unauthenticated: strict rate limit
  if (!isAuthenticated) {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return Response.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "common.error.rateLimited" },
        },
        { status: 429 },
      );
    }
  }

  const formData = await req.formData();
  const fileEntry = formData.get("file");
  const companyId = formData.get("companyId") as string | null;
  const systemSlug = formData.get("systemSlug") as string | null;
  const userId = formData.get("userId") as string | null;
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

  if (
    !(fileEntry instanceof File) || companyId === null || systemSlug === null ||
    userId === null || !category
  ) {
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

  // All validation happens inside the control callback
  const control = (
    savePath: string[],
    _concurrencyMap: Record<string, number | undefined>,
  ): SaveControlResult => {
    if (!isAuthenticated) {
      // Unauthenticated: strict path whitelist, size, extensions, concurrency
      return {
        accessAllowed: isPathAllowed(savePath, PUBLIC_ALLOWED_PATH_PATTERNS),
        maxFileSizeBytes: PUBLIC_MAX_SIZE_BYTES,
        allowedExtensions: PUBLIC_ALLOWED_EXTENSIONS,
        concurrencyIdentifiers: [savePath.slice(0, 3).join("/")],
        kbytesPerSecond: 10,
      };
    }
    // Authenticated
    return {
      accessAllowed: true,
      maxFileSizeBytes: AUTH_MAX_SIZE_BYTES,
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
