#!/usr/bin/env node

/**
 * Minimal smoke test.
 *
 * Keep it dependency-free so CI can validate the repo boots.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
assert.equal(pkg.name, 'mini_engine');

console.log('smoke: ok');
