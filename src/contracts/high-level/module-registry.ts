// ============================================================================
// Module registry contracts — job starters, lifecycle hooks, and event types
// used by the registration system (§4.6).
// ============================================================================

/** Background job starter signature. */
export type JobStarter = () => void;

/** Lifecycle hook callback signature. */
export type LifecycleHook = (payload: Record<string, unknown>) => Promise<void>;

/** Known lifecycle event names. */
export type LifecycleEvent = "lead:delete" | "lead:verify";
