import { createRaidBattlefield as createBaseBattlefield } from './hardcore-battlefield.js';

// Custom encounter artwork is now rendered inside the primary battlefield
// canvas so the draw order is deterministic:
// background -> boss -> foreground -> telegraphs -> players -> player attacks.
// Keep this module as a compatibility wrapper for the existing import chain.
export function createRaidBattlefield(options = {}) {
  return createBaseBattlefield(options);
}
