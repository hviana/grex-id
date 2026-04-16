import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";

function withAuthRateLimit() {
  return async (
    req: Request,
    ctx: RequestContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const core = Core.getInstance();
    const rateLimitPerMinute = Number(
      (await core.getSetting("auth.rateLimit.perMinute")) || 5,
    );
    return withRateLimit({
      windowMs: 60_000,
      maxRequests: rateLimitPerMinute,
    })(req, ctx, next);
  };
}

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

export const GET = compose(withAuthRateLimit(), (req, ctx) => {
  // Extract params from URL for Next.js dynamic route compatibility
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const provider = segments[segments.indexOf("oauth") + 1] ?? "";
  return getHandler(req, ctx, { params: Promise.resolve({ provider }) });
});

export const POST = compose(withAuthRateLimit(), (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const provider = segments[segments.indexOf("oauth") + 1] ?? "";
  return postHandler(req, ctx, { params: Promise.resolve({ provider }) });
});
