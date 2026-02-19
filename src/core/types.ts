/** Shared core types used by module contracts. */

export type DocId = string;
export type Term = string;

/** A token produced by a tokenizer. */
export interface Token {
  term: Term;
  /** 0-based position within the source text (token index, not byte offset). */
  position: number;
  /** Optional character offsets for highlighting. */
  startOffset?: number;
  endOffset?: number;
}

/** Minimal document representation used by indexing pipeline. */
export interface DocumentInput {
  id: DocId;
  text: string;
  /** Optional fields for later (title, tags, etc). */
  fields?: Record<string, unknown>;
}

export interface SearchHit {
  docId: DocId;
  score: number;
}

export interface TopKResult<T> {
  items: T[];
}
