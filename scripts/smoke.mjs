#!/usr/bin/env node

/**
 * CI smoke test.
 *
 * Goals:
 * - Boot the HTTP server
 * - Verify /health
 * - Ingest a few docs
 * - Query /search for both fulltext + prefix modes
 *
 * Optional (gated) perf smoke:
 * - Ingest ~50k docs and ensure lookup latency is within a budget
 *   (disabled by default to avoid flaky CI)
 */

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import process from 'node:process';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const SERVER_START_CMD = process.env.SMOKE_SERVER_CMD ?? '';
const SERVER_BUILD_CMD = process.env.SMOKE_BUILD_CMD ?? 'npm run build';
const SERVER_START_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_START_TIMEOUT_MS ?? 20_000);

const PERF_ENABLED = (process.env.SMOKE_PERF ?? '').toLowerCase() === '1' || (process.env.SMOKE_PERF ?? '').toLowerCase() === 'true';
const PERF_DOCS = Number(process.env.SMOKE_PERF_DOCS ?? 50_000);
const PERF_LOOKUP_BUDGET_MS = Number(process.env.SMOKE_PERF_BUDGET_MS ?? 50);

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(path, init) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

async function waitForHealthy(timeoutMs) {
  const start = nowMs();
  let lastErr;
  while (nowMs() - start < timeoutMs) {
    try {
      const { res, body } = await fetchJson('/health', { method: 'GET' });
      if (res.ok) return body;
      lastErr = new Error(`non-2xx /health: ${res.status} ${JSON.stringify(body)}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for /health after ${timeoutMs}ms: ${lastErr?.message ?? lastErr}`);
}

function spawnServer(cmd) {
  // shell=true so callers can pass something like: "npm run dev" or "node dist/server.js"
  const child = spawn(cmd, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: process.env.PORT ?? '3000',
      HOST: process.env.HOST ?? '127.0.0.1',
    },
  });

  const logs = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => (logs.stdout += d.toString()));
  child.stderr.on('data', (d) => (logs.stderr += d.toString()));

  return { child, logs };
}

async function main() {
  let server;
  let serverLogs;

  if (SERVER_START_CMD) {
    // Build first so dist/* exists.
    await new Promise((resolve, reject) => {
      const b = spawn(SERVER_BUILD_CMD, { shell: true, stdio: 'inherit', env: process.env });
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed: ${SERVER_BUILD_CMD} (exit ${code})`))));
      b.on('error', reject);
    });

    ({ child: server, logs: serverLogs } = spawnServer(SERVER_START_CMD));
  }

  try {
    const health = await waitForHealthy(SERVER_START_TIMEOUT_MS);
    assert.ok(health, 'health response should be non-empty');

    // Ingest a few docs
    const docs = [
      { id: 'doc-1', title: 'Alpha', body: 'hello world alpha' },
      { id: 'doc-2', title: 'Beta', body: 'hello world beta' },
      { id: 'doc-3', title: 'Prefix', body: 'prelude prefixing prefabricated' },
    ];

    // Expectation: POST /documents accepts { documents: [...] }
    // If Kael lands a slightly different shape, we can adjust quickly.
    const ing = await fetchJson('/documents', {
      method: 'POST',
      body: JSON.stringify({ documents: docs }),
    });
    assert.ok(ing.res.ok, `POST /documents should succeed: ${ing.res.status} ${JSON.stringify(ing.body)}`);

    // fulltext search
    const s1 = await fetchJson('/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'alpha', mode: 'fulltext', limit: 10 }),
    });
    assert.ok(s1.res.ok, `POST /search fulltext should succeed: ${s1.res.status} ${JSON.stringify(s1.body)}`);
    assert.ok(Array.isArray(s1.body?.results ?? s1.body), 'search results should be an array (or in .results)');
    const r1 = (s1.body?.results ?? s1.body);
    assert.ok(r1.some((r) => (r.id ?? r.documentId) === 'doc-1'), 'fulltext search should include doc-1');

    // prefix search
    const s2 = await fetchJson('/search', {
      method: 'POST',
      body: JSON.stringify({ query: 'pre', mode: 'prefix', limit: 10 }),
    });
    assert.ok(s2.res.ok, `POST /search prefix should succeed: ${s2.res.status} ${JSON.stringify(s2.body)}`);
    const r2 = (s2.body?.results ?? s2.body);
    assert.ok(r2.some((r) => (r.id ?? r.documentId) === 'doc-3'), 'prefix search should include doc-3');

    if (PERF_ENABLED) {
      // Ingest PERF_DOCS docs in a single request (server may chunk internally).
      const bigDocs = Array.from({ length: PERF_DOCS }, (_, i) => ({
        id: `perf-${i}`,
        title: `Perf ${i}`,
        body: `lorem ipsum token${i % 1000} commonterm`,
      }));

      const ing2 = await fetchJson('/documents', {
        method: 'POST',
        body: JSON.stringify({ documents: bigDocs }),
      });
      assert.ok(ing2.res.ok, `perf ingest should succeed: ${ing2.res.status} ${JSON.stringify(ing2.body)}`);

      // warmup
      await fetchJson('/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'commonterm', mode: 'fulltext', limit: 10 }),
      });

      const t0 = nowMs();
      const q = await fetchJson('/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'token42', mode: 'fulltext', limit: 10 }),
      });
      const dt = nowMs() - t0;

      assert.ok(q.res.ok, `perf search should succeed: ${q.res.status} ${JSON.stringify(q.body)}`);
      assert.ok(dt <= PERF_LOOKUP_BUDGET_MS, `perf lookup exceeded budget: ${dt.toFixed(2)}ms > ${PERF_LOOKUP_BUDGET_MS}ms`);
      console.log(`perf: lookup ${dt.toFixed(2)}ms (budget ${PERF_LOOKUP_BUDGET_MS}ms) docs=${PERF_DOCS}`);
    }

    console.log('smoke: ok');
  } catch (e) {
    if (serverLogs) {
      console.error('--- server stdout ---');
      console.error(serverLogs.stdout.slice(-4000));
      console.error('--- server stderr ---');
      console.error(serverLogs.stderr.slice(-4000));
    }
    throw e;
  } finally {
    if (server) {
      server.kill('SIGTERM');
      await sleep(250);
      if (!server.killed) server.kill('SIGKILL');
    }
  }
}

await main();
