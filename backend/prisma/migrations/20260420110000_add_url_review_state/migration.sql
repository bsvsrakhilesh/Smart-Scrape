ALTER TABLE "Url"
ADD COLUMN "lastReviewedAt" TIMESTAMP(3);

ALTER TABLE "Url"
ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Url_needsReview_idx" ON "Url"("needsReview");
CREATE INDEX "Url_lastReviewedAt_idx" ON "Url"("lastReviewedAt");