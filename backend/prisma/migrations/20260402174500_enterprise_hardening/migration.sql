DO $$
BEGIN
  CREATE TYPE "AuditResourceType" AS ENUM (
    'DOCUMENT',
    'FILE',
    'URL',
    'NOTEBOOK',
    'NOTE',
    'NOTEBOOK_SOURCE',
    'ISSUE',
    'AGENCY',
    'CHAT_RUN',
    'SYSTEM'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AuditLogStatus" AS ENUM (
    'SUCCESS',
    'FAILURE',
    'INFO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "EmbeddingJob"
  ADD COLUMN "queueJobId" TEXT,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "progressPct" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "statusMessage" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorAt" TIMESTAMP(3),
  ADD COLUMN "meta" JSONB;

ALTER TABLE "IngestionJob"
  ADD COLUMN "queueJobId" TEXT,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "progressPct" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "statusMessage" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorAt" TIMESTAMP(3),
  ADD COLUMN "meta" JSONB;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" "AuditResourceType" NOT NULL,
  "resourceId" TEXT,
  "status" "AuditLogStatus" NOT NULL DEFAULT 'INFO',
  "actorId" TEXT,
  "actorName" TEXT,
  "requestId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx"
  ON "AuditLog"("resourceType", "resourceId", "createdAt");

CREATE INDEX "AuditLog_action_createdAt_idx"
  ON "AuditLog"("action", "createdAt");

CREATE INDEX "AuditLog_requestId_idx"
  ON "AuditLog"("requestId");