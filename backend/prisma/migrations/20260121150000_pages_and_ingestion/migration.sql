-- Add evidence/span columns to SourceChunk
ALTER TABLE "public"."SourceChunk"
  ADD COLUMN "globalStart" INTEGER,
  ADD COLUMN "globalEnd"   INTEGER,
  ADD COLUMN "pageStart"   INTEGER,
  ADD COLUMN "pageEnd"     INTEGER,
  ADD COLUMN "charStart"   INTEGER,
  ADD COLUMN "charEnd"     INTEGER;

-- CreateTable: IngestionJob
CREATE TABLE "public"."IngestionJob" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "public"."TaggingStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestionJob_sourceId_key" ON "public"."IngestionJob"("sourceId");

ALTER TABLE "public"."IngestionJob"
  ADD CONSTRAINT "IngestionJob_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "public"."NotebookSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SourcePage
CREATE TABLE "public"."SourcePage" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "globalStart" INTEGER NOT NULL,
  "globalEnd" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourcePage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourcePage_sourceId_pageNumber_key" ON "public"."SourcePage"("sourceId", "pageNumber");
CREATE INDEX "SourcePage_sourceId_idx" ON "public"."SourcePage"("sourceId");

ALTER TABLE "public"."SourcePage"
  ADD CONSTRAINT "SourcePage_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "public"."NotebookSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
