import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";


async function getHandler(
  req: Request,
  ctx: RequestContext,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;

  // OAuth redirect to provider — implementation pending
  return Response.json(
    {
      success: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "auth.error.oauthNotConfigured",
      },
    },
    { status: 501 },
  );
}

async function postHandler(
  req: Request,
  ctx: RequestContext,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;

  // OAuth callback handler — implementation pending
  return Response.json(
    {
      success: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "auth.error.oauthNotConfigured",
      },
    },
    { status: 501 },
  );
}

export const GET = compose(withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }), (req, ctx) => {
  // Extract params from URL for Next.js dynamic route compatibility
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const provider = segments[segments.indexOf("oauth") + 1] ?? "";
  return getHandler(req, ctx, { params: Promise.resolve({ provider }) });
});

export const POST = compose(withAuthAndLimit({ rateLimit: { windowMs: 60_000, maxRequests: 5 } }), (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const provider = segments[segments.indexOf("oauth") + 1] ?? "";
  return postHandler(req, ctx, { params: Promise.resolve({ provider }) });
});
