-- AlterTable
ALTER TABLE "public"."StoredFile" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "taggerVersion" TEXT,
ADD COLUMN     "tagsMeta" JSONB;

-- AlterTable
ALTER TABLE "public"."Url" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "taggerVersion" TEXT,
ADD COLUMN     "tagsMeta" JSONB;
