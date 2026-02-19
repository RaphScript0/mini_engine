import type { DocId, SearchHit, Term } from "./types.js";
import type { InvertedIndex, IndexStats } from "./invertedIndex.js";

export interface RankOptions {
  /** Smoothing constant for IDF. */
  idfSmoothing?: number;
  /** If provided, cap results before final sort/topK. */
  candidateLimit?: number;
}

export interface RankContext {
  index: InvertedIndex;
  stats: IndexStats;
  /** Optional precomputed doc lengths in tokens (for normalization). */
  docLengths?: Map<DocId, number>;
}

/**
 * Scores documents for a query.
 *
 * Phase 1 focuses on TF-IDF; later can evolve to BM25 etc.
 */
export interface Ranker {
  rank(queryTerms: Term[], ctx: RankContext, options?: RankOptions): SearchHit[];
}
