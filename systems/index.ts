// Subsystem boot entry point.
// Each system registers via its own register.ts.
// This file aggregates all system registrations.
// Frameworks register via frameworks/index.ts — not here.

import { register as registerGrexId } from "./grex-id/register";

export function registerAllSystems(): void {
  registerGrexId();
  // Future subsystems register here:
  // registerFooSystem();
}
