import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = resolve(root, 'node_modules/phaser/dist/phaser.esm.js');
const destinationDir = resolve(root, 'public/vendor');
const destination = resolve(destinationDir, 'phaser.esm.js');

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
console.log('Prepared public/vendor/phaser.esm.js');
