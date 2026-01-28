-- CreateTable: EmbeddingJob
CREATE TABLE "public"."EmbeddingJob" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "public"."TaggingStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmbeddingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmbeddingJob_sourceId_key" ON "public"."EmbeddingJob"("sourceId");

ALTER TABLE "public"."EmbeddingJob"
  ADD CONSTRAINT "EmbeddingJob_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "public"."NotebookSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
