import type { RequestContext } from "./tenant-context";
import type { RateLimitConfig } from "./rate-limiter";

export type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

export interface AuthAndLimitOptions {
  roles?: string[];
  requireAuthenticated?: boolean;
  entities?: string[];
  rateLimit?: RateLimitConfig;
}
