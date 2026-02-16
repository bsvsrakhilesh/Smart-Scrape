/*
  Warnings:

  - A unique constraint covering the columns `[canonical_url]` on the table `Url` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Url_url_key";

-- AlterTable
ALTER TABLE "Url" ADD COLUMN     "canonical_url" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Url_canonical_url_key" ON "Url"("canonical_url");
