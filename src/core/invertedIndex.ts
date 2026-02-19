import type { DocId, Term } from "./types.js";

export interface Posting {
  docId: DocId;
  /** term frequency within the doc */
  tf: number;
  /** optional positions for phrase queries */
  positions?: number[];
}

export interface PostingsList {
  term: Term;
  df: number;
  postings: Posting[];
}

export interface IndexStats {
  docCount: number;
  /** average document length in tokens (if tracked) */
  avgDocLen?: number;
}

/**
 * Inverted index mapping term -> postings.
 *
 * Contract notes:
 * - implementations may store postings compressed / sorted by docId
 * - `getPostings` should return postings sorted by docId for efficient merge/intersect
 */
export interface InvertedIndex {
  addDocument(docId: DocId, termFrequencies: Map<Term, number>, positionsByTerm?: Map<Term, number[]>): void;
  removeDocument(docId: DocId): void;

  getPostings(term: Term): PostingsList | undefined;
  hasTerm(term: Term): boolean;

  getStats(): IndexStats;
}
