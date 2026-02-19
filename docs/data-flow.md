# Data flow + performance notes

## Indexing flow
1. **Tokenizer**: `text -> Iterable<Token>`
2. Build per-doc maps:
   - `termFrequencies: Map<Term, number>`
   - optionally `positionsByTerm: Map<Term, number[]>`
3. **InvertedIndex.addDocument(docId, termFrequencies, positionsByTerm)`
4. **Trie.insert(term)`** for dictionary/prefix lookup (optional but useful for autocomplete/spell)

### Performance considerations
- Prefer iterators/generators from tokenizer to avoid large intermediate arrays.
- Postings lists should be kept **sorted by docId** to support fast merges/intersections.
- Tracking positions increases memory; keep optional.

## Query flow
1. Tokenize query to `queryTerms: Term[]`
2. For each term: `index.getPostings(term)`
3. **Ranker.rank(queryTerms, ctx)`**
   - TF-IDF: accumulate score per doc based on term TF and corpus IDF
4. **TopK/Heap**: maintain a fixed-size min-heap to extract top K without sorting all hits.

### TF-IDF notes
- IDF smoothing matters to avoid div-by-zero for very common terms.
- Candidate limiting (early cut) can reduce work on extremely frequent terms.
