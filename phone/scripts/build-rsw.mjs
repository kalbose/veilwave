import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'rsw-browser.js')],
  bundle: true,
  format: 'iife',
  globalName: 'RSW',
  outfile: path.join(root, 'www', 'rsw.bundle.js'),
  platform: 'browser',
  target: ['es2020'],
  minify: true,
});

console.log('built www/rsw.bundle.js');
