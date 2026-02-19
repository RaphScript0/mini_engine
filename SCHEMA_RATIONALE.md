# Phase 1 Contracts — Postgres Schema + Indexing Strategy

This repo was empty, so this PR bootstraps a minimal but production-shaped Postgres schema for:

- **documents** (raw text + metadata)
- **terms** (dictionary)
- **postings** (inverted index rows)
- **analytics** (TF/DF + corpus/doc stats)

## Tables

### `documents`
Stores raw content, metadata, and optional full-text vector.

- `id UUID PK`: stable doc identifier.
- `external_id TEXT UNIQUE`: optional upstream ID.
- `metadata JSONB`: flexible fields for source-specific attributes.
- `content_tsv TSVECTOR`: optional; maintained via trigger for FTS/hybrid.

### `terms`
Dictionary of unique normalized tokens.

- `id BIGSERIAL PK`: compact key for postings.
- `normalized TEXT UNIQUE`: canonical token (lowercased/stemmed/etc, done in app).

### `postings`
Core inverted index: **one row per (doc, term)**.

- `PRIMARY KEY (doc_id, term_id)` ensures uniqueness.
- `tf INTEGER`: term frequency in document.
- `positions INTEGER[]`: optional token offsets for phrase queries / proximity.
- `payload JSONB`: room for per-field boosts, norms, etc.

### Analytics

#### `document_stats`
Per-document stats used for scoring:

- `token_count` (document length)
- `unique_terms`

#### `term_stats`
Per-term corpus stats:

- `df INTEGER`: document frequency (# docs containing term)
- `corpus_tf BIGINT`: total occurrences across corpus

#### `corpus_stats`
Singleton snapshot for global corpus counts (for IDF / BM25):

- `doc_count`, `token_count`

## Indexing strategy (recommended)

### Documents
- `UNIQUE(external_id)` for idempotent ingestion.
- `BTREE(source)`, `BTREE(uri)`, `BTREE(created_at)` for filtering.
- `GIN(metadata)` for JSONB containment queries (`metadata @> {...}`).
- `GIN(content_tsv)` for Postgres full-text lookup.
- `GIN(title gin_trgm_ops)` (via `pg_trgm`) for substring/fuzzy title search.

### Terms
- `UNIQUE(normalized)` for dictionary lookup.
- `GIN(normalized gin_trgm_ops)` optional for fuzzy term search (debug/autocomplete).

### Postings
Primary access patterns:

1) **term -> docs** (retrieval):
- `BTREE(term_id, doc_id)` supports fast scans for a term.

2) **doc -> terms** (updates / analytics recompute):
- `BTREE(doc_id, term_id)` supports fast enumeration of a doc’s terms.

3) Phrase/proximity ops on `positions` (optional):
- `GIN(positions)` helps if you use array operators in SQL.

### Term stats
- `BTREE(df)` helps for pruning/analysis queries (e.g., top/bottom DF terms).

## TF/DF storage notes

- **TF** lives in `postings.tf` as the raw per-document count.
- **DF** lives in `term_stats.df` (1 row per term) and should be updated by:
  - batch recomputation, or
  - incremental maintenance when ingesting documents (upsert + increment).

For BM25-style scoring you typically need:

- `tf` per (doc, term)
- `dl` (document length): `document_stats.token_count`
- `df` per term: `term_stats.df`
- `N` total docs: `corpus_stats.doc_count`

## Operational guidance

- Maintain `documents.content_hash` for dedupe if desired (app computes SHA-256).
- Consider partitioning `postings` by `term_id` hash/range only when scale requires it.
- Keep ingestion in transactions: insert doc -> upsert terms -> upsert postings -> update stats.
