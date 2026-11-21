// Bundles the game (including three.js) into dist/index.html and copies models/textures to dist/assets.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
mkdirSync(join(root, 'dist'), { recursive: true });

async function build() {
  const t0 = Date.now();
  const res = await esbuild.build({
    entryPoints: [join(root, 'src/main.ts')],
    bundle: true, format: 'iife', target: 'es2022', minify: !watch, sourcemap: false, write: false,
    legalComments: 'none',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = readFileSync(join(root, 'index.html'), 'utf8')
    .replace('<script type="module" src="./src/main.ts"></script>', () => `<script>${js}</script>`);
  writeFileSync(join(root, 'dist/index.html'), html);
  cpSync(join(root, 'public/assets'), join(root, 'dist/assets'), { recursive: true });
  console.log(`[build] dist/index.html ${(html.length / 1024).toFixed(0)} KB in ${Date.now() - t0} ms`);
}

await build();
if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let timer = null;
  fsWatch(join(root, 'src'), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => build().catch((e) => console.error(e.message)), 120); });
  fsWatch(join(root, 'index.html'), () => build().catch((e) => console.error(e.message)));
  console.log('[build] watching for changes…');
}
