import http from "node:http";
import { randomUUID } from "node:crypto";

import { PROBLEM_CONTENT_TYPE, problem, type FieldError } from "./problem.js";
import { asInt, asString, isRecord, pushErr } from "./validation.js";
import { createInMemoryEngine, decodeCursor, encodeCursor, type Engine } from "./engine.js";

const SERVICE = "mini_engine";
const VERSION = "0.1.0";

export interface ServerOptions {
  port?: number;
  metricsEnabled?: boolean;
  engine?: Engine;
}

export function createServer(opts: ServerOptions = {}): http.Server {
  const start = Date.now();
  const engine = opts.engine ?? createInMemoryEngine();
  const metricsEnabled = opts.metricsEnabled ?? false;

  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          status: "ok",
          service: SERVICE,
          version: VERSION,
          uptimeMs: Date.now() - start,
        });
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        if (!metricsEnabled) {
          return sendProblem(res, 404, problem({ status: 404, code: "NOT_FOUND", detail: "metrics not enabled", instance: url.pathname, requestId }));
        }
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; version=0.0.4");
        res.end("# metrics not implemented\n");
        return;
      }

      if (req.method === "POST" && url.pathname === "/documents") {
        if (!isJson(req)) {
          return sendProblem(res, 415, problem({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", detail: "content-type must be application/json", instance: url.pathname, requestId }));
        }
        const body = await readJson(req);
        if (!isRecord(body)) {
          return sendProblem(res, 400, problem({ status: 400, code: "INVALID_ARGUMENT", detail: "body must be an object", instance: url.pathname, requestId }));
        }

        const errors: FieldError[] = [];
        const docsVal = body.documents;
        if (!Array.isArray(docsVal)) pushErr(errors, "$.documents", "must be an array");
        const docs = Array.isArray(docsVal) ? docsVal : [];
        if (Array.isArray(docsVal) && docsVal.length < 1) pushErr(errors, "$.documents", "must contain at least 1 item");
        if (Array.isArray(docsVal) && docsVal.length > 1000) pushErr(errors, "$.documents", "must contain at most 1000 items");

        const onDuplicate = isRecord(body.options) ? asString(body.options.onDuplicate) ?? "replace" : "replace";
        if (onDuplicate !== "replace" && onDuplicate !== "skip") {
          pushErr(errors, "$.options.onDuplicate", "must be one of: replace, skip");
        }

        if (errors.length) {
          return sendProblem(res, 400, problem({ status: 400, code: "INVALID_ARGUMENT", detail: "invalid request", instance: url.pathname, requestId, errors }));
        }

        let ingested = 0;
        const failures: Array<{ index: number; id: string | null; code: string; message: string }> = [];

        for (let i = 0; i < docs.length; i++) {
          const d = docs[i];
          if (!isRecord(d)) {
            failures.push({ index: i, id: null, code: "INVALID_ARGUMENT", message: "document must be an object" });
            continue;
          }

          const id = asString(d.id);
          const text = asString(d.text);
          const metadata = isRecord(d.metadata) ? (d.metadata as Record<string, unknown>) : undefined;

          if (!id || id.length < 1) {
            failures.push({ index: i, id: null, code: "INVALID_ARGUMENT", message: "id must be non-empty" });
            continue;
          }
          if (id.length > 256) {
            failures.push({ index: i, id, code: "INVALID_ARGUMENT", message: "id too long" });
            continue;
          }
          if (!text || text.length < 1) {
            failures.push({ index: i, id, code: "INVALID_ARGUMENT", message: "text must be non-empty" });
            continue;
          }
          if (text.length > 200000) {
            failures.push({ index: i, id, code: "INVALID_ARGUMENT", message: "text too long" });
            continue;
          }

          if (onDuplicate === "skip" && engine.has(id)) {
            continue;
          }

          engine.upsert({ id, text, metadata });
          ingested++;
        }

        const failed = failures.length;
        const status = failed > 0 ? 207 : 200;
        return sendJson(res, status, { ingested, failed, failures });
      }

      if (req.method === "POST" && url.pathname === "/search") {
        if (!isJson(req)) {
          return sendProblem(res, 415, problem({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", detail: "content-type must be application/json", instance: url.pathname, requestId }));
        }

        const started = Date.now();
        const body = await readJson(req);
        if (!isRecord(body)) {
          return sendProblem(res, 400, problem({ status: 400, code: "INVALID_ARGUMENT", detail: "body must be an object", instance: url.pathname, requestId }));
        }

        const errors: FieldError[] = [];
        const query = asString(body.query);
        if (!query) pushErr(errors, "$.query", "must be non-empty");
        if (query && query.length > 4096) pushErr(errors, "$.query", "too long");

        const topK = asInt(body.topK) ?? 10;
        if (topK < 1 || topK > 100) pushErr(errors, "$.topK", "must be between 1 and 100");

        const mode = asString(body.mode) ?? "fulltext";
        if (mode !== "fulltext" && mode !== "prefix") pushErr(errors, "$.mode", "must be one of: fulltext, prefix");

        let cursor: string | undefined;
        if (isRecord(body.page) && body.page.cursor != null) {
          const cursorStr = asString(body.page.cursor);
          if (!cursorStr) {
            pushErr(errors, "$.page.cursor", "must be a string");
          } else {
            try {
              cursor = decodeCursor(cursorStr).token;
            } catch {
              pushErr(errors, "$.page.cursor", "invalid cursor");
            }
          }
        }

        if (errors.length) {
          return sendProblem(res, 400, problem({ status: 400, code: "INVALID_ARGUMENT", detail: "invalid request", instance: url.pathname, requestId, errors }));
        }

        const r = engine.search({ query: query!, topK, mode: mode as "fulltext" | "prefix", cursor });
        return sendJson(res, 200, {
          results: r.results.map((x) => ({ id: x.id, score: x.score, highlights: [], metadata: x.metadata })),
          page: { nextCursor: r.nextCursor ? encodeCursor({ token: r.nextCursor }) : null },
          tookMs: Date.now() - started,
        });
      }

      return sendProblem(res, 404, problem({ status: 404, code: "NOT_FOUND", detail: "not found", instance: url.pathname, requestId }));
    } catch (e) {
      return sendProblem(res, 500, problem({ status: 500, code: "INTERNAL", detail: "internal error", instance: url.pathname, requestId }));
    }
  });
}

export async function startServer(opts: ServerOptions = {}): Promise<{ server: http.Server; port: number }> {
  const server = createServer(opts);
  const port = opts.port ?? Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return { server, port: actualPort };
}

function isJson(req: http.IncomingMessage): boolean {
  const ct = (req.headers["content-type"] ?? "").toString();
  return ct.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length ? JSON.parse(raw) : null;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(data);
}

function sendProblem(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", PROBLEM_CONTENT_TYPE);
  res.end(data);
}
