ALTER TABLE "Url"
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

CREATE INDEX "Url_visibility_idx" ON "Url"("visibility");