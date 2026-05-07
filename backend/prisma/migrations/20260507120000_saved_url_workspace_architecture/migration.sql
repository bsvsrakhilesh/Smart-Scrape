-- Saved URLs durable operations, server-side review state, and query indexes.

CREATE TABLE "SavedUrlReview" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "urlId" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedUrlReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "statusMessage" TEXT,
    "error" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationRunItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedUrlReview_ownerId_urlId_key" ON "SavedUrlReview"("ownerId", "urlId");
CREATE INDEX "SavedUrlReview_urlId_idx" ON "SavedUrlReview"("urlId");
CREATE INDEX "SavedUrlReview_ownerId_reviewedAt_idx" ON "SavedUrlReview"("ownerId", "reviewedAt");

CREATE INDEX "OperationRun_ownerId_updatedAt_idx" ON "OperationRun"("ownerId", "updatedAt");
CREATE INDEX "OperationRun_type_status_idx" ON "OperationRun"("type", "status");
CREATE INDEX "OperationRun_status_updatedAt_idx" ON "OperationRun"("status", "updatedAt");

CREATE INDEX "OperationRunItem_runId_status_idx" ON "OperationRunItem"("runId", "status");
CREATE INDEX "OperationRunItem_resourceType_resourceId_idx" ON "OperationRunItem"("resourceType", "resourceId");

ALTER TABLE "SavedUrlReview"
  ADD CONSTRAINT "SavedUrlReview_urlId_fkey"
  FOREIGN KEY ("urlId") REFERENCES "Url"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperationRunItem"
  ADD CONSTRAINT "OperationRunItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "OperationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Url_createdAt_idx" ON "Url"("createdAt");
CREATE INDEX IF NOT EXISTS "Url_updatedAt_idx" ON "Url"("updatedAt");
CREATE INDEX IF NOT EXISTS "Url_publishedAt_idx" ON "Url"("publishedAt");
CREATE INDEX IF NOT EXISTS "Url_isFavorited_idx" ON "Url"("isFavorited");
CREATE INDEX IF NOT EXISTS "Url_visibility_idx" ON "Url"("visibility");
CREATE INDEX IF NOT EXISTS "Url_taggingStatus_idx" ON "Url"("taggingStatus");
CREATE INDEX IF NOT EXISTS "Url_normalizedDomain_createdAt_idx" ON "Url"("normalizedDomain", "createdAt");
CREATE INDEX IF NOT EXISTS "Url_taggingStatus_updatedAt_idx" ON "Url"("taggingStatus", "updatedAt");
CREATE INDEX IF NOT EXISTS "Url_isFavorited_updatedAt_idx" ON "Url"("isFavorited", "updatedAt");
