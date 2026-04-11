import type { RequestContext } from "@/src/contracts/auth";

export type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

export function compose(...middlewares: Middleware[]): Middleware {
  return async (
    req: Request,
    ctx: RequestContext,
    next: () => Promise<Response>,
  ) => {
    let index = -1;

    async function dispatch(i: number): Promise<Response> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      if (i === middlewares.length) {
        return next();
      }

      const middleware = middlewares[i];
      return middleware(req, ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}
