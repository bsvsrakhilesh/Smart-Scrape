-- AlterTable
ALTER TABLE "public"."Url" ADD COLUMN     "isFavorited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
