import { NextRequest } from "next/server";
import { getFS } from "@/server/utils/fs";
import type { ReadControlResult } from "@hviana/surreal-fs";

async function tryGetAuth(
  req: NextRequest,
): Promise<{ userId: string; companyId?: string; roles: string[] } | null> {
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

export async function GET(req: NextRequest) {
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

  const auth = await tryGetAuth(req);
  const isAuthenticated = auth !== null;

  const path = uri.split("/");
  const fs = await getFS();

  const control = (
    readPath: string[],
    _concurrencyMap: Record<string, number | undefined>,
  ): ReadControlResult => {
    if (!isAuthenticated) {
      return {
        accessAllowed: true,
        concurrencyIdentifiers: [readPath.slice(0, 3).join("/")],
        kbytesPerSecond: 10,
      };
    }
    return {
      accessAllowed: true,
      concurrencyIdentifiers: [readPath.slice(0, 3).join("/")],
    };
  };

  const file = await fs.read({ path, control });

  if (!file || !("content" in file) || !file.content) {
    return Response.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.file.notFound" },
      },
      { status: 404 },
    );
  }

  const metadata = file.metadata ?? {};
  const fileName = metadata.fileName || path[path.length - 1];
  const mimeType = metadata.mimeType || "application/octet-stream";

  return new Response(file.content, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${
        encodeURIComponent(fileName)
      }"`,
      "Content-Length": String(file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
