// Frontend component registry — aggregated across all subsystems.
// This file is NOT server-only so component registrations are
// available in the client bundle.

import { registerFrontend as registerGrexIdFrontend } from "./grex-id/src/frontend";

export function registerAllSystemsFrontend(): void {
  registerGrexIdFrontend();
  // Future subsystems register here:
  // registerFooSystemFrontend();
}
