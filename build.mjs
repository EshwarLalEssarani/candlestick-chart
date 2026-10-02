/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

rmSync('dist', { recursive: true, force: true });

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  target: 'es2020',
  platform: 'browser',
  legalComments: 'none',
  banner: { js: '/*! Eshwar Lal — https://github.com/EshwarLalEssarani | CandlestickChart v1.1.0 | MIT */' },
};

await esbuild.build({
  ...shared,
  format: 'esm',
  outfile: 'dist/index.mjs',
  sourcemap: true,
});

await esbuild.build({
  ...shared,
  format: 'cjs',
  outfile: 'dist/index.cjs',
  sourcemap: true,
});

await esbuild.build({
  ...shared,
  format: 'iife',
  globalName: 'CandlestickChart',
  outfile: 'dist/candlestick-chart.min.js',
  minify: true,
});

execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
