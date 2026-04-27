import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("compose");

export type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Composes middlewares into a function compatible with Next.js App Router
 * route handlers. The returned function satisfies the
 * `(req, ctx) => Promise<Response>` signature expected by Next.js while
 * internally running the middleware chain with our RequestContext.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compose(...middlewares: Middleware[]): any {
  return async (
    req: Request,
    _nextCtx?: unknown,
  ): Promise<Response> => {
    const ctx: RequestContext = {
      tenantContext: null as unknown as RequestContext["tenantContext"],
    };
    let index = -1;

    async function dispatch(i: number): Promise<Response> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      if (i === middlewares.length) {
        throw new Error("No terminal handler");
      }

      const middleware = middlewares[i];
      return middleware(req, ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}
