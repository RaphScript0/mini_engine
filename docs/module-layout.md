# Module layout proposal

Suggested folders:

- `src/core/` — **contracts + pure data structures**
  - `types.ts` shared types
  - `tokenizer.ts` Tokenizer interface
  - `invertedIndex.ts` InvertedIndex interface + postings types
  - `trie.ts` Trie interface
  - `ranker.ts` Ranker interface (TF-IDF)
  - `heap.ts` Heap + TopK selector interface

- `src/impl/` — concrete implementations (Phase 2)
  - `simpleTokenizer.ts`
  - `mapInvertedIndex.ts`
  - `compactTrie.ts`
  - `tfidfRanker.ts`
  - `binaryHeap.ts`

- `src/pipeline/` — orchestration
  - indexing pipeline: doc -> tokenize -> term freqs -> index
  - query pipeline: query -> tokenize -> postings -> rank -> topK

Keeping `core/` contract-only avoids circular deps and lets us swap implementations.
