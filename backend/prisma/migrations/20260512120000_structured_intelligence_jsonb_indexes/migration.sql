-- Query support for evidence-backed structured intelligence stored in tagsMeta.
-- The expression uses COALESCE so older rows may keep either tagger or aiTagger as
-- the canonical metadata namespace.

CREATE INDEX IF NOT EXISTS "Url_structuredIntelligenceV1_gin_idx"
ON "Url"
USING GIN (
  (COALESCE(
    "tagsMeta" #> '{tagger,structuredIntelligenceV1}',
    "tagsMeta" #> '{aiTagger,structuredIntelligenceV1}'
  )) jsonb_path_ops
);

CREATE INDEX IF NOT EXISTS "StoredFile_structuredIntelligenceV1_gin_idx"
ON "StoredFile"
USING GIN (
  (COALESCE(
    "tagsMeta" #> '{tagger,structuredIntelligenceV1}',
    "tagsMeta" #> '{aiTagger,structuredIntelligenceV1}'
  )) jsonb_path_ops
);
