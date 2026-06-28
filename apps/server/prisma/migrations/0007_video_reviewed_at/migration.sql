ALTER TABLE "VideoFile"
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "VideoFile_reviewedAt_idx" ON "VideoFile"("reviewedAt");
