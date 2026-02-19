-- Phase 1 Contracts: Postgres schema + indexing strategy
-- Focus: documents, terms, postings, analytics (TF/DF) storage.
--
-- Notes:
-- - Uses UUID PKs for documents. Terms are BIGSERIAL for compact postings.
-- - Postings store tf + positions (optionally) per (doc, term).
-- - DF is maintained in term_stats (can be updated via batch jobs).
-- - Designed for incremental ingestion and fast term->docs queries.

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- trigram search (optional)

-- -------------------------
-- documents
-- -------------------------
CREATE TABLE IF NOT EXISTS documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      TEXT UNIQUE,                 -- optional stable upstream id
  source           TEXT,                        -- crawler/source system
  uri              TEXT,                        -- url/path
  title            TEXT,
  content          TEXT NOT NULL,               -- raw text (or extracted)
  content_tsv      TSVECTOR,                    -- optional full-text
  content_hash     BYTEA,                       -- for dedupe (sha256)
  lang             TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Optional TSVECTOR maintenance. If your app populates content_tsv itself, skip.
CREATE OR REPLACE FUNCTION documents_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', coalesce(NEW.title,'') || ' ' || coalesce(NEW.content,''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_tsv ON documents;
CREATE TRIGGER trg_documents_tsv
BEFORE INSERT OR UPDATE OF title, content ON documents
FOR EACH ROW EXECUTE FUNCTION documents_tsv_trigger();

-- -------------------------
-- terms (dictionary)
-- -------------------------
CREATE TABLE IF NOT EXISTS terms (
  id          BIGSERIAL PRIMARY KEY,
  term        TEXT NOT NULL,
  normalized  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized)
);

-- -------------------------
-- postings (inverted index)
-- -------------------------
-- One row per (doc, term).
-- Store:
--  - tf: raw term frequency in doc
--  - positions: optional sorted list of token offsets (can be NULL to save space)
--  - payload: room for extra scoring signals (bm25 normalization, fields, etc)
CREATE TABLE IF NOT EXISTS postings (
  doc_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  term_id    BIGINT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  tf         INTEGER NOT NULL CHECK (tf >= 0),
  positions  INTEGER[],
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (doc_id, term_id)
);

-- -------------------------
-- analytics / corpus stats
-- -------------------------
-- Document-level stats for scoring (length, etc)
CREATE TABLE IF NOT EXISTS document_stats (
  doc_id        UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  token_count   INTEGER NOT NULL CHECK (token_count >= 0),
  unique_terms  INTEGER NOT NULL CHECK (unique_terms >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Term-level stats: DF, total TF across corpus.
-- Keep these consistent via batch recompute or incremental upserts.
CREATE TABLE IF NOT EXISTS term_stats (
  term_id      BIGINT PRIMARY KEY REFERENCES terms(id) ON DELETE CASCADE,
  df           INTEGER NOT NULL CHECK (df >= 0),
  corpus_tf    BIGINT NOT NULL CHECK (corpus_tf >= 0),
  last_calc_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional: snapshot of overall corpus size for scoring (N)
CREATE TABLE IF NOT EXISTS corpus_stats (
  id           SMALLINT PRIMARY KEY DEFAULT 1,
  doc_count    BIGINT NOT NULL CHECK (doc_count >= 0),
  token_count  BIGINT NOT NULL CHECK (token_count >= 0),
  last_calc_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corpus_stats_singleton CHECK (id = 1)
);

-- -------------------------
-- Indexing strategy
-- -------------------------

-- documents query patterns: by external_id, source, uri, metadata, full text
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents USING btree (source);
CREATE INDEX IF NOT EXISTS idx_documents_uri ON documents USING btree (uri);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON documents USING gin (metadata);

-- Full-text search (optional, useful for fallback / hybrid search)
CREATE INDEX IF NOT EXISTS idx_documents_content_tsv_gin ON documents USING gin (content_tsv);

-- Similar/substring search on title/uri if you need it
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING gin (title gin_trgm_ops);

-- terms: normalized lookup + optional trigram for prefix/fuzzy
CREATE INDEX IF NOT EXISTS idx_terms_term_trgm ON terms USING gin (normalized gin_trgm_ops);

-- postings: core inverted index access patterns
-- 1) given term_id, fetch docs + tf quickly
CREATE INDEX IF NOT EXISTS idx_postings_term_doc ON postings USING btree (term_id, doc_id);

-- 2) given doc_id, iterate all terms (for updates/debug/recompute)
CREATE INDEX IF NOT EXISTS idx_postings_doc_term ON postings USING btree (doc_id, term_id);

-- positions search (phrase queries) could use GIN over int[] if you do array ops
-- (usually app-level phrase evaluation is enough; enable if needed)
CREATE INDEX IF NOT EXISTS idx_postings_positions_gin ON postings USING gin (positions);

-- document_stats: mostly PK lookups (doc_id)
-- term_stats: mostly PK lookups (term_id) + order by df for pruning
CREATE INDEX IF NOT EXISTS idx_term_stats_df ON term_stats USING btree (df);

COMMIT;
