// Backwards-compatible module name while the rest of the client still imports
// phaser-battlefield.js. The live renderer is a lightweight high-DPI Canvas2D
// engine using SVG source artwork and fully local player movement.
export { createRaidBattlefield } from './vector-battlefield.js';
