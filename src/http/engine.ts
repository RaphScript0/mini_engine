import {
  MemorySearchEngine,
  MemoryInvertedIndex,
  MemoryTrie,
  SimpleTokenizer,
  TfIdfRanker,
  MinHeapTopKSelector,
  type SearchOptions,
} from "../core/impl/index.js";

export interface EngineDocumentInput {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  topK: number;
  mode: "fulltext" | "prefix";
  cursor?: string;
}

export interface SearchHit {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchHit[];
  nextCursor: string | null;
}

export interface Engine {
  upsert(doc: EngineDocumentInput): void;
  upsertMany(docs: EngineDocumentInput[]): void;
  has(id: string): boolean;
  search(q: SearchQuery): SearchResponse;
}

/**
 * HTTP-friendly cursor encoding.
 *
 * We store and return the engine's cursor token as-is, but wrap it in JSON so we can
 * extend later without breaking clients.
 */
export function encodeCursor(payload: { token: string }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodeCursor(cursor: string): { token: string } {
  const raw = Buffer.from(cursor, "base64").toString("utf8");
  const parsed = JSON.parse(raw) as { token?: unknown };
  if (typeof parsed.token !== "string" || !parsed.token.length) {
    throw new Error("invalid cursor");
  }
  return { token: parsed.token };
}

export function createInMemoryEngine(): Engine {
  const tokenizer = new SimpleTokenizer();
  const index = new MemoryInvertedIndex();
  const trie = new MemoryTrie();
  const ranker = new TfIdfRanker();
  const topK = new MinHeapTopKSelector<import("../core/types.js").SearchHit>();

  const engine = new MemorySearchEngine({ tokenizer, index, trie, ranker, topK });
  const docs = new Map<string, EngineDocumentInput>();

  return {
    upsert(doc) {
      docs.set(doc.id, doc);
      engine.upsertDocuments([{ id: doc.id, text: doc.text, fields: doc.metadata }]);
    },
    upsertMany(input) {
      for (const d of input) docs.set(d.id, d);
      engine.upsertDocuments(input.map((d) => ({ id: d.id, text: d.text, fields: d.metadata })));
    },
    has(id) {
      return docs.has(id);
    },
    search(q) {
      const options: SearchOptions = {
        limit: q.topK,
        enablePrefix: q.mode === "prefix",
      };

      if (q.cursor) {
        options.cursor = q.cursor;
      }

      const page = engine.search(q.query, options);

      return {
        results: page.hits.map((h) => ({
          id: h.docId,
          score: h.score,
          metadata: (docs.get(h.docId)?.metadata ?? undefined) as Record<string, unknown> | undefined,
        })),
        nextCursor: page.nextCursor ?? null,
      };
    },
  };
}
