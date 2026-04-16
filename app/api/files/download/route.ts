import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import type { ReadControlResult } from "@hviana/surreal-fs";

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

  const isAuthenticated = ctx.claims !== undefined;
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

// withAuth without requireAuthenticated allows both authenticated and anonymous access
export const GET = compose(
  withAuth(),
  async (req, ctx) => getHandler(req, ctx),
);
