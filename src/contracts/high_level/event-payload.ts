/**
 * Describes a single database mutation to be applied by the verification
 * callback.  Producers that call `communicationGuard` pack one or more
 * `EventChange` entries inside `payload.changes` so the approvals route
 * can replay them generically via `applyEventPayload`.
 *
 * `fields` must carry names and values that are **ready for insertion**
 * into the target table — pre-standardized, pre-validated, pre-encrypted.
 * The `applyEventPayload` utility writes them directly without re-running
 * the pipeline.
 */
export interface EventChange {
  /** "create" | "update" | "delete" call genericCreate / genericUpdate /
   *  genericDelete.  "custom" is reserved for complex multi-table
   *  operations that cannot be expressed as a single-row CRUD call. */
  action: "create" | "update" | "delete" | "custom";

  /** The actionKey from the verification_request — used by custom
   *  handlers to dispatch complex multi-table operations. */
  actionKey: string;

  /** Target table name (e.g. "entity_channel", "user", "tenant"). */
  entity: string;

  /** Column → value map ready for direct DB insertion. */
  fields: Record<string, unknown>;

  /** Record id — required for "update", "delete", and "custom". */
  id?: string;
}

/** Payload shape stored in `verification_request.payload` for any
 *  action that mutates the database. */
export interface EventPayload {
  changes: EventChange[];
}
