/*
  Warnings:

  - You are about to drop the `Job` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."SourceKind" AS ENUM ('URL', 'FILE');

-- DropTable
DROP TABLE "public"."Job";

-- CreateTable
CREATE TABLE "public"."Notebook" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotebookSource" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "kind" "public"."SourceKind" NOT NULL,
    "urlId" INTEGER,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourceChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Note" (
    "id" TEXT NOT NULL,
    "notebookId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotebookSource_notebookId_urlId_key" ON "public"."NotebookSource"("notebookId", "urlId");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookSource_notebookId_fileId_key" ON "public"."NotebookSource"("notebookId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChunk_sourceId_idx_key" ON "public"."SourceChunk"("sourceId", "idx");

-- AddForeignKey
ALTER TABLE "public"."NotebookSource" ADD CONSTRAINT "NotebookSource_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "public"."Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NotebookSource" ADD CONSTRAINT "NotebookSource_urlId_fkey" FOREIGN KEY ("urlId") REFERENCES "public"."Url"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NotebookSource" ADD CONSTRAINT "NotebookSource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourceChunk" ADD CONSTRAINT "SourceChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "public"."NotebookSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Note" ADD CONSTRAINT "Note_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "public"."Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
