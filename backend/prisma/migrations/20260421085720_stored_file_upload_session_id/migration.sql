/*
  Warnings:

  - A unique constraint covering the columns `[uploadSessionId]` on the table `StoredFile` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Url_visibility_idx";

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "uploadSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_uploadSessionId_key" ON "StoredFile"("uploadSessionId");
