import * as Phaser from '/vendor/phaser.esm.js';

// Phaser 4 removed Phaser.Geom.Point. The lightweight battlefield still
// passes point-like values into Graphics.fillPoints, so provide the tiny
// compatibility shape here until the generated geometry is converted fully
// to plain { x, y } objects.
if (!Phaser.Geom.Point) {
  Object.defineProperty(Phaser.Geom, 'Point', {
    configurable: true,
    value: class Point {
      constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
      }
    }
  });
}

export { createRaidBattlefield } from './phaser-battlefield-fast.js';
