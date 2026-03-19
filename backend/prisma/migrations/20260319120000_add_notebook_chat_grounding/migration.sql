ALTER TABLE "public"."NotebookChatRun"
ADD COLUMN "groundingVersion" TEXT,
ADD COLUMN "groundingStatus" TEXT,
ADD COLUMN "supportedClaimsCount" INTEGER,
ADD COLUMN "unsupportedClaimsCount" INTEGER,
ADD COLUMN "grounding" JSONB;