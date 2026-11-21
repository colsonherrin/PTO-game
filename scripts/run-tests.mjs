// Bundles each tests/*.test.ts with esbuild and runs them with Node's built-in test runner.
import * as esbuild from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const out = '.test-build';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts'));
await esbuild.build({ entryPoints: files.map((f) => `tests/${f}`), outdir: out, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'error' });
const r = spawnSync(process.execPath, ['--test', ...files.map((f) => `${out}/${f.replace('.ts', '.mjs')}`)], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
