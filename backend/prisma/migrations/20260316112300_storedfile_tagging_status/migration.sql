ALTER TABLE "StoredFile"
ADD COLUMN "taggingStatus" "TaggingStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "taggingJobId" TEXT,
ADD COLUMN "taggingError" TEXT;

CREATE INDEX "StoredFile_taggingStatus_idx" ON "StoredFile"("taggingStatus");