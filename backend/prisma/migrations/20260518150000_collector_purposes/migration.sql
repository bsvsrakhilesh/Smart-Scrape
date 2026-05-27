CREATE TABLE IF NOT EXISTS "CollectorPurpose" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "researchQuestion" TEXT NOT NULL,
  "jurisdiction" TEXT,
  "region" TEXT,
  "yearFrom" TEXT,
  "yearTo" TEXT,
  "sourcePreferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetActors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "outputGoal" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "plan" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CollectorPurposeSearch" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "laneKey" TEXT,
  "parameters" JSONB,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectorPurposeSearch_purposeId_fkey"
    FOREIGN KEY ("purposeId") REFERENCES "CollectorPurpose"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CollectorPurposeUrl" (
  "purposeId" TEXT NOT NULL,
  "urlId" INTEGER NOT NULL,
  "sourceSearchId" TEXT,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectorPurposeUrl_pkey" PRIMARY KEY ("purposeId", "urlId"),
  CONSTRAINT "CollectorPurposeUrl_purposeId_fkey"
    FOREIGN KEY ("purposeId") REFERENCES "CollectorPurpose"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CollectorPurposeUrl_urlId_fkey"
    FOREIGN KEY ("urlId") REFERENCES "Url"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CollectorPurposeUrl_sourceSearchId_fkey"
    FOREIGN KEY ("sourceSearchId") REFERENCES "CollectorPurposeSearch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "GovernanceAnswerSession" ADD COLUMN IF NOT EXISTS "collectorPurposeId" TEXT;
ALTER TABLE "GovernanceAnswerRun" ADD COLUMN IF NOT EXISTS "collectorPurposeId" TEXT;

DO $$ BEGIN
  ALTER TABLE "GovernanceAnswerSession"
    ADD CONSTRAINT "GovernanceAnswerSession_collectorPurposeId_fkey"
    FOREIGN KEY ("collectorPurposeId") REFERENCES "CollectorPurpose"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "GovernanceAnswerRun"
    ADD CONSTRAINT "GovernanceAnswerRun_collectorPurposeId_fkey"
    FOREIGN KEY ("collectorPurposeId") REFERENCES "CollectorPurpose"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "CollectorPurpose_ownerId_updatedAt_idx" ON "CollectorPurpose"("ownerId", "updatedAt");
CREATE INDEX IF NOT EXISTS "CollectorPurpose_ownerId_status_idx" ON "CollectorPurpose"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "CollectorPurposeSearch_purposeId_createdAt_idx" ON "CollectorPurposeSearch"("purposeId", "createdAt");
CREATE INDEX IF NOT EXISTS "CollectorPurposeUrl_urlId_idx" ON "CollectorPurposeUrl"("urlId");
CREATE INDEX IF NOT EXISTS "CollectorPurposeUrl_sourceSearchId_idx" ON "CollectorPurposeUrl"("sourceSearchId");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerSession_collectorPurposeId_idx" ON "GovernanceAnswerSession"("collectorPurposeId");
CREATE INDEX IF NOT EXISTS "GovernanceAnswerRun_collectorPurposeId_idx" ON "GovernanceAnswerRun"("collectorPurposeId");
