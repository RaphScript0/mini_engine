import type { DocumentInput, DocId, SearchHit, Term } from "../types.js";
import type { Tokenizer } from "../tokenizer.js";
import type { InvertedIndex } from "../invertedIndex.js";
import type { Trie } from "../trie.js";
import type { Ranker } from "../ranker.js";
import type { TopKSelector } from "../heap.js";

export interface SearchOptions {
  limit?: number;
  /** cursor token returned by previous search */
  cursor?: string;
  /** if provided, prefix-complete these partial terms and include them as query terms */
  enablePrefix?: boolean;
  prefixLimit?: number;
  /** cap union candidates before final topK */
  candidateLimit?: number;
}

export interface SearchPage {
  hits: SearchHit[];
  nextCursor?: string;
}

export interface EngineDeps {
  tokenizer: Tokenizer;
  index: InvertedIndex;
  trie: Trie;
  ranker: Ranker;
  topK: TopKSelector<SearchHit>;
}

export class MemorySearchEngine {
  private readonly docs = new Map<DocId, DocumentInput>();
  private readonly docLengths = new Map<DocId, number>();

  constructor(private readonly deps: EngineDeps) {}

  upsertDocuments(docs: DocumentInput[]): void {
    for (const doc of docs) {
      this.docs.set(doc.id, doc);

      const termFreqs = new Map<Term, number>();
      const positions = new Map<Term, number[]>();
      let length = 0;

      for (const tok of this.deps.tokenizer.tokenize(doc.text, { normalizeCase: true })) {
        length++;
        termFreqs.set(tok.term, (termFreqs.get(tok.term) ?? 0) + 1);
        let arr = positions.get(tok.term);
        if (!arr) {
          arr = [];
          positions.set(tok.term, arr);
        }
        arr.push(tok.position);

        // dictionary + autosuggest
        this.deps.trie.insert(tok.term, { trackFrequency: true });
      }

      this.docLengths.set(doc.id, length);
      this.deps.index.addDocument(doc.id, termFreqs, positions);
    }
  }

  removeDocument(docId: DocId): void {
    this.docs.delete(docId);
    this.docLengths.delete(docId);
    this.deps.index.removeDocument(docId);
  }

  search(rawQuery: string, options?: SearchOptions): SearchPage {
    const limit = options?.limit ?? 10;
    const enablePrefix = options?.enablePrefix ?? true;
    const prefixLimit = options?.prefixLimit ?? 5;

    const queryTerms: Term[] = [];
    for (const tok of this.deps.tokenizer.tokenize(rawQuery, { normalizeCase: true, removeStopWords: true })) {
      queryTerms.push(tok.term);
    }

    if (enablePrefix && rawQuery.length) {
      const last = rawQuery.trim().split(/\s+/).pop();
      if (last && last.length >= 2) {
        const comps = this.deps.trie.complete(last.toLowerCase(), prefixLimit);
        for (const c of comps) queryTerms.push(c.term);
      }
    }

    const allHits = this.deps.ranker.rank(queryTerms, {
      index: this.deps.index,
      stats: this.deps.index.getStats(),
      docLengths: this.docLengths,
    }, { candidateLimit: options?.candidateLimit });

    // cursor is base64 of last docId in previous page (stable sort by score then docId)
    let startIdx = 0;
    if (options?.cursor) {
      try {
        const decoded = Buffer.from(options.cursor, "base64").toString("utf8");
        const idx = allHits.findIndex((h) => h.docId === decoded);
        if (idx >= 0) startIdx = idx + 1;
      } catch {
        // ignore invalid cursor
      }
    }

    const pageHits = allHits.slice(startIdx, startIdx + limit);
    const nextCursor =
      startIdx + limit < allHits.length && pageHits.length
        ? Buffer.from(pageHits[pageHits.length - 1]!.docId, "utf8").toString("base64")
        : undefined;

    // topK within page for safety (ranker already sorted; but keep contract explicit)
    const hits = this.deps.topK.topK(pageHits, limit, (a, b) => b.score - a.score || (a.docId < b.docId ? -1 : 1));

    return { hits, nextCursor };
  }
}
