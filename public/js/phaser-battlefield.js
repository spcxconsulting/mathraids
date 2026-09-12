// Backwards-compatible module name while the rest of the client still imports
// phaser-battlefield.js. The live renderer is now a tiny Canvas2D pixel engine.
export { createRaidBattlefield } from './pixel-battlefield.js';
