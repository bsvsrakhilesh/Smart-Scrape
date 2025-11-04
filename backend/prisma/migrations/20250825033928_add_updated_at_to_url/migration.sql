-- Add updatedAt column with default value for existing records
ALTER TABLE "public"."Url" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Update existing records to have updatedAt = createdAt
UPDATE "public"."Url" SET "updatedAt" = "createdAt" WHERE "updatedAt" = CURRENT_TIMESTAMP;

-- Remove the default constraint since we want Prisma to handle it
ALTER TABLE "public"."Url" ALTER COLUMN "updatedAt" DROP DEFAULT;
