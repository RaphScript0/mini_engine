import type { DocId, Term } from "../types.js";
import type { InvertedIndex, IndexStats, Posting, PostingsList } from "../invertedIndex.js";

type PostingEntry = { tf: number; positions?: number[] };

/**
 * Simple in-memory inverted index.
 *
 * Data structure:
 * - term -> (docId -> {tf, positions})
 *
 * `getPostings()` materializes a sorted array by docId.
 */
export class MemoryInvertedIndex implements InvertedIndex {
  private readonly termToDocMap = new Map<Term, Map<DocId, PostingEntry>>();
  private readonly docs = new Set<DocId>();

  addDocument(
    docId: DocId,
    termFrequencies: Map<Term, number>,
    positionsByTerm?: Map<Term, number[]>,
  ): void {
    this.docs.add(docId);

    for (const [term, tf] of termFrequencies) {
      let docMap = this.termToDocMap.get(term);
      if (!docMap) {
        docMap = new Map();
        this.termToDocMap.set(term, docMap);
      }
      docMap.set(docId, {
        tf,
        positions: positionsByTerm?.get(term),
      });
    }
  }

  removeDocument(docId: DocId): void {
    if (!this.docs.has(docId)) return;
    this.docs.delete(docId);

    for (const [, docMap] of this.termToDocMap) {
      docMap.delete(docId);
    }
  }

  getPostings(term: Term): PostingsList | undefined {
    const docMap = this.termToDocMap.get(term);
    if (!docMap) return undefined;

    const postings: Posting[] = [];
    for (const [docId, entry] of docMap) {
      postings.push({ docId, tf: entry.tf, positions: entry.positions });
    }

    // sort for merge/intersection
    postings.sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));

    return {
      term,
      df: postings.length,
      postings,
    };
  }

  hasTerm(term: Term): boolean {
    const m = this.termToDocMap.get(term);
    return !!m && m.size > 0;
  }

  getStats(): IndexStats {
    return { docCount: this.docs.size };
  }
}
