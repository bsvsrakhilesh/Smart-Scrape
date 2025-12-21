-- CreateEnum
CREATE TYPE "TaggingStatus" AS ENUM ('NONE', 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Url" ADD COLUMN     "taggingError" TEXT,
ADD COLUMN     "taggingJobId" TEXT,
ADD COLUMN     "taggingStatus" "TaggingStatus" NOT NULL DEFAULT 'NONE';
