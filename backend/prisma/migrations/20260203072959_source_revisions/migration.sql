/*
  Warnings:

  - A unique constraint covering the columns `[revisionId,idx]` on the table `SourceChunk` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[revisionId,pageNumber]` on the table `SourcePage` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `revisionId` to the `SourceChunk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `revisionId` to the `SourcePage` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "SourceChunk_embedding_hnsw";

-- DropIndex
DROP INDEX "SourceChunk_fts_gin";

-- DropIndex
DROP INDEX "SourceChunk_sourceId_idx_key";

-- DropIndex
DROP INDEX "SourcePage_sourceId_pageNumber_key";

-- AlterTable
ALTER TABLE "NotebookSource" ADD COLUMN     "activeRevisionId" TEXT;

-- AlterTable
ALTER TABLE "SourceChunk" ADD COLUMN     "revisionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SourcePage" ADD COLUMN     "revisionId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "SourceRevision" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "contentHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceRevision_sourceId_isActive_idx" ON "SourceRevision"("sourceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRevision_sourceId_ordinal_key" ON "SourceRevision"("sourceId", "ordinal");

-- CreateIndex
CREATE INDEX "SourceChunk_sourceId_revisionId_idx" ON "SourceChunk"("sourceId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChunk_revisionId_idx_key" ON "SourceChunk"("revisionId", "idx");

-- CreateIndex
CREATE INDEX "SourcePage_sourceId_revisionId_idx" ON "SourcePage"("sourceId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePage_revisionId_pageNumber_key" ON "SourcePage"("revisionId", "pageNumber");

-- AddForeignKey
ALTER TABLE "NotebookSource" ADD CONSTRAINT "NotebookSource_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "SourceRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRevision" ADD CONSTRAINT "SourceRevision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NotebookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceChunk" ADD CONSTRAINT "SourceChunk_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SourceRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePage" ADD CONSTRAINT "SourcePage_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SourceRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
