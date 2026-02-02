-- CreateEnum
CREATE TYPE "CaptureType" AS ENUM ('UPLOAD', 'URL_TEXT', 'URL_PDF');

-- AlterTable
ALTER TABLE "StoredFile"
  ADD COLUMN "captureType" "CaptureType" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "urlId" INTEGER;

-- CreateIndex
CREATE INDEX "StoredFile_urlId_idx" ON "StoredFile"("urlId");

-- AddForeignKey
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_urlId_fkey"
  FOREIGN KEY ("urlId") REFERENCES "Url"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
