ALTER TABLE "OperationRunItem"
  ADD COLUMN "resourceKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "resourceId" DROP NOT NULL;

CREATE INDEX "OperationRunItem_resourceType_resourceKey_idx"
  ON "OperationRunItem"("resourceType", "resourceKey");
