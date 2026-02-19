import type { Term } from "./types.js";

export interface TrieInsertOptions {
  /** If true, keep a frequency counter per term (useful for autosuggest). */
  trackFrequency?: boolean;
}

export interface TriePrefixResult {
  term: Term;
  /** optional score (e.g. frequency) */
  weight?: number;
}

/**
 * Prefix trie for term dictionary + autocomplete.
 */
export interface Trie {
  insert(term: Term, opts?: TrieInsertOptions): void;
  remove(term: Term): void;
  has(term: Term): boolean;

  /** Returns up to `limit` terms that share the prefix. */
  complete(prefix: string, limit?: number): TriePrefixResult[];
}
