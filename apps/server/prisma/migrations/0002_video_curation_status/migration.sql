ALTER TABLE "VideoFile"
  ADD COLUMN "curationStatus" TEXT NOT NULL DEFAULT 'none';

CREATE INDEX "VideoFile_curationStatus_idx" ON "VideoFile"("curationStatus");
