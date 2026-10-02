/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

mkdirSync('.tmp', { recursive: true });
await esbuild.build({
  entryPoints: ['tests/engine.test.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '.tmp/engine.test.mjs',
  sourcemap: 'inline',
  external: ['node:test', 'node:assert/strict'],
});

const result = spawnSync(process.execPath, ['--test', '.tmp/engine.test.mjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
