import type { RequestContext } from "./tenant-context";
import type { RateLimitConfig } from "./rate-limiter";

export type Middleware = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

export interface AuthAndLimitOptions {
  /**
   * Access rules evaluated in order — first match grants access.
   *
   * For each element:
   * - systemSlug + roles specified → user must have any named role
   *   specifically within that system (checked via roleIds intersection).
   * - roles only (no systemSlug) → any of the named roles from any system.
   * - systemSlug only (no roles) → any authenticated actor in that system.
   * - neither specified (or empty array / undefined) → no role restrictions.
   */
  accesses?: { systemSlug?: string; roles?: string[] }[];
  requireAuthenticated?: boolean;
  entities?: string[];
  rateLimit?: RateLimitConfig;
}
