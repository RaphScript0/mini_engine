import type { DocId, SearchHit, Term } from "../types.js";
import type { Posting } from "../invertedIndex.js";
import type { RankContext, RankOptions, Ranker } from "../ranker.js";

function idf(docCount: number, df: number, smoothing: number): number {
  // classic smooth: log((N + s) / (df + s)) + 1
  return Math.log((docCount + smoothing) / (df + smoothing)) + 1;
}

/**
 * Performance-minded TF-IDF ranker:
 * - candidate generation via union of postings
 * - iterate postings lists in increasing df to reduce work
 * - optional candidateLimit gate
 */
export class TfIdfRanker implements Ranker {
  rank(queryTerms: Term[], ctx: RankContext, options?: RankOptions): SearchHit[] {
    const docCount = ctx.stats.docCount;
    if (!docCount || queryTerms.length === 0) return [];

    const smoothing = options?.idfSmoothing ?? 1;
    const candidateLimit = options?.candidateLimit;

    // gather postings for query terms
    const termLists: Array<{ term: Term; idf: number; postings: Posting[] }> = [];
    for (const t of queryTerms) {
      const pl = ctx.index.getPostings(t);
      if (!pl || pl.df === 0) continue;
      termLists.push({ term: t, idf: idf(docCount, pl.df, smoothing), postings: pl.postings });
    }
    if (termLists.length === 0) return [];

    termLists.sort((a, b) => a.postings.length - b.postings.length);

    const scores = new Map<DocId, number>();

    // union scoring
    for (const tl of termLists) {
      for (const p of tl.postings) {
        const prev = scores.get(p.docId) ?? 0;
        scores.set(p.docId, prev + p.tf * tl.idf);
      }
    }

    // optional cap: keep only best candidateLimit by partial score (cheap prune)
    let candidates: Array<[DocId, number]> = Array.from(scores.entries());
    if (candidateLimit && candidates.length > candidateLimit) {
      candidates.sort((a, b) => b[1] - a[1]);
      candidates = candidates.slice(0, candidateLimit);
    }

    // normalize by doc length if present
    const hits: SearchHit[] = candidates.map(([docId, score]) => {
      const len = ctx.docLengths?.get(docId);
      const norm = len && len > 0 ? score / Math.sqrt(len) : score;
      return { docId, score: norm };
    });

    hits.sort((a, b) => b.score - a.score || (a.docId < b.docId ? -1 : 1));
    return hits;
  }
}
