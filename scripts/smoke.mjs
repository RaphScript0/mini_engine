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
import net from 'node:net';

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

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function fetchJson(baseUrl, path, init) {
  const res = await fetch(`${baseUrl}${path}`, {
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

async function waitForHealthy(baseUrl, timeoutMs) {
  const start = nowMs();
  let lastErr;
  while (nowMs() - start < timeoutMs) {
    try {
      const { res, body } = await fetchJson(baseUrl, '/health', { method: 'GET' });
      if (res.ok) return body;
      lastErr = new Error(`non-2xx /health: ${res.status} ${JSON.stringify(body)}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for /health after ${timeoutMs}ms: ${lastErr?.message ?? lastErr}`);
}

function spawnServer(cmd, { port }) {
  // shell=true so callers can pass something like: "npm run dev" or "node dist/server.js"
  const child = spawn(cmd, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: process.env.HOST ?? '127.0.0.1',
    },
  });

  const logs = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => (logs.stdout += d.toString()));
  child.stderr.on('data', (d) => (logs.stderr += d.toString()));

  return { child, logs };
}

function normalizeResults(body) {
  const r = body?.results ?? body;
  return Array.isArray(r) ? r : [];
}

function toIdSet(results) {
  return new Set(results.map((r) => r.id ?? r.documentId).filter(Boolean));
}

async function main() {
  const port = process.env.PORT ? Number(process.env.PORT) : await getFreePort();
  const baseUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${port}`;

  let server;
  let serverLogs;

  if (SERVER_START_CMD) {
    // Build first so dist/* exists.
    await new Promise((resolve, reject) => {
      const b = spawn(SERVER_BUILD_CMD, { shell: true, stdio: 'inherit', env: process.env });
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed: ${SERVER_BUILD_CMD} (exit ${code})`))));
      b.on('error', reject);
    });

    ({ child: server, logs: serverLogs } = spawnServer(SERVER_START_CMD, { port }));
  }

  try {
    const health = await waitForHealthy(baseUrl, SERVER_START_TIMEOUT_MS);
    assert.ok(health, 'health response should be non-empty');

    // Ingest a few docs
    const docs = [
      { id: 'doc-1', text: 'hello world alpha', metadata: { title: 'Alpha' } },
      { id: 'doc-2', text: 'hello world beta', metadata: { title: 'Beta' } },
      { id: 'doc-3', text: 'prelude prefixing prefabricated', metadata: { title: 'Prefix' } },
    ];

    const ing = await fetchJson(baseUrl, '/documents', {
      method: 'POST',
      body: JSON.stringify({ documents: docs }),
    });
    assert.ok(ing.res.ok, `POST /documents should succeed: ${ing.res.status} ${JSON.stringify(ing.body)}`);

    // Deterministic: retry search briefly to allow async indexing.
    const searchUntil = async ({ query, mode, topK, expectId, timeoutMs = 5_000 }) => {
      const start = nowMs();
      let lastBody;
      while (nowMs() - start < timeoutMs) {
        const s = await fetchJson(baseUrl, '/search', {
          method: 'POST',
          body: JSON.stringify({ query, mode, topK }),
        });
        assert.ok(s.res.ok, `POST /search should succeed: ${s.res.status} ${JSON.stringify(s.body)}`);
        lastBody = s.body;
        const ids = toIdSet(normalizeResults(s.body));
        if (ids.has(expectId)) return { body: s.body, ids };
        await sleep(200);
      }
      throw new Error(`expected search(${mode}:${query}) to include ${expectId} within ${timeoutMs}ms; last body: ${JSON.stringify(lastBody)}`);
    };

    const ft = await searchUntil({ query: 'alpha', mode: 'fulltext', topK: 10, expectId: 'doc-1' });
    assert.deepEqual([...ft.ids].sort(), ['doc-1'], 'fulltext "alpha" should deterministically return only doc-1');

    const px = await searchUntil({ query: 'pre', mode: 'prefix', topK: 10, expectId: 'doc-3' });
    assert.deepEqual([...px.ids].sort(), ['doc-3'], 'prefix "pre" should deterministically return only doc-3');

    if (PERF_ENABLED) {
      const bigDocs = Array.from({ length: PERF_DOCS }, (_, i) => ({
        id: `perf-${i}`,
        text: `lorem ipsum token${i % 1000} commonterm`,
      }));

      const ing2 = await fetchJson(baseUrl, '/documents', {
        method: 'POST',
        body: JSON.stringify({ documents: bigDocs }),
      });
      assert.ok(ing2.res.ok, `perf ingest should succeed: ${ing2.res.status} ${JSON.stringify(ing2.body)}`);

      // warmup
      await fetchJson(baseUrl, '/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'commonterm', mode: 'fulltext', topK: 10 }),
      });

      const t0 = nowMs();
      const q = await fetchJson(baseUrl, '/search', {
        method: 'POST',
        body: JSON.stringify({ query: 'token42', mode: 'fulltext', topK: 10 }),
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
