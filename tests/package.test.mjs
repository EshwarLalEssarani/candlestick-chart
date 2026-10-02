/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { create, version } from '../dist/index.mjs';

test('esm and cjs entries expose the same API', () => {
  assert.equal(typeof version, 'string');
  assert.equal(typeof create, 'function');
  const require = createRequire(import.meta.url);
  const cjs = require('../dist/index.cjs');
  assert.equal(typeof cjs.create, 'function');
  assert.equal(typeof cjs.Chart, 'function');
  assert.equal(cjs.version, version);
});

test('iife bundle installs the CandlestickChart global', () => {
  const code = fs.readFileSync(new URL('../dist/candlestick-chart.min.js', import.meta.url), 'utf8');
  const sandbox = { console };
  vm.runInNewContext(code, sandbox);
  assert.equal(typeof sandbox.CandlestickChart.create, 'function');
  assert.equal(typeof sandbox.CandlestickChart.Chart, 'function');
  assert.equal(sandbox.CandlestickChart.version, version);
});
