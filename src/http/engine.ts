export interface EngineDocumentInput {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface SearchMode {
  mode: "fulltext" | "prefix";
}

export interface SearchQuery {
  query: string;
  topK: number;
  mode: "fulltext" | "prefix";
  cursorOffset?: number;
  filtersEquals?: Record<string, string | number | boolean>;
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
  has(id: string): boolean;
  search(q: SearchQuery): SearchResponse;
}

export function createInMemoryEngine(): Engine {
  const docs = new Map<string, EngineDocumentInput>();

  return {
    upsert(doc) {
      docs.set(doc.id, doc);
    },
    has(id) {
      return docs.has(id);
    },
    search(q) {
      // stub: returns nothing, but pagination plumbing works.
      const offset = q.cursorOffset ?? 0;
      const results: SearchHit[] = [];
      const nextCursor = offset + q.topK < results.length ? encodeCursor({ offset: offset + q.topK }) : null;
      return { results: results.slice(offset, offset + q.topK), nextCursor };
    },
  };
}

export function encodeCursor(payload: { offset: number }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodeCursor(cursor: string): { offset: number } {
  const raw = Buffer.from(cursor, "base64").toString("utf8");
  const parsed = JSON.parse(raw) as { offset?: unknown };
  if (typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
    throw new Error("invalid cursor");
  }
  return { offset: parsed.offset };
}
