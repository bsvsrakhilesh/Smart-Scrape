-- 1) Full-text search: generated tsvector + GIN index
ALTER TABLE "SourceChunk"
ADD COLUMN IF NOT EXISTS "fts" tsvector
GENERATED ALWAYS AS (to_tsvector('english', coalesce("text", ''))) STORED;

CREATE INDEX IF NOT EXISTS "SourceChunk_fts_gin"
ON "SourceChunk" USING GIN ("fts");

-- 2) Vector index for cosine distance (<=>): HNSW
-- Requires pgvector extension (already enabled in your earlier migration)
CREATE INDEX IF NOT EXISTS "SourceChunk_embedding_hnsw"
ON "SourceChunk" USING hnsw ("embedding" vector_cosine_ops);
