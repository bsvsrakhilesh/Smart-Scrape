-- Uploaded files should not mirror binary SHA-256 into contentHash
-- before AI extraction has produced a normalized content hash.

UPDATE "StoredFile"
SET "contentHash" = NULL
WHERE "sha256" IS NOT NULL
  AND "contentHash" = "sha256"
  AND (
    "taggingStatus" <> 'SUCCESS'
    OR "taggerVersion" IS NULL
    OR "taggerVersion" = ''
  );