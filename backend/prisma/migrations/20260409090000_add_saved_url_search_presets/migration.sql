-- CreateTable
CREATE TABLE "SavedUrlSearchPreset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "sortKey" TEXT NOT NULL,
    "sortOrder" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "selectedCollectionId" TEXT,
    "queueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedUrlSearchPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedUrlSearchPreset_ownerId_name_key" ON "SavedUrlSearchPreset"("ownerId", "name");

-- CreateIndex
CREATE INDEX "SavedUrlSearchPreset_ownerId_updatedAt_idx" ON "SavedUrlSearchPreset"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "SavedUrlSearchPreset"
ADD CONSTRAINT "SavedUrlSearchPreset_selectedCollectionId_fkey"
FOREIGN KEY ("selectedCollectionId")
REFERENCES "Collection"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;