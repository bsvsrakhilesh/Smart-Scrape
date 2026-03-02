-- AlterTable
ALTER TABLE "Url" ADD COLUMN     "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishedAt" TIMESTAMP(3);
