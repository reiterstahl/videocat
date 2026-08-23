ALTER TABLE "VideoFile"
ADD COLUMN "isPresent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "missingSince" TIMESTAMP(3),
ADD COLUMN "lastSeenScanId" UUID;

CREATE INDEX "VideoFile_isPresent_idx" ON "VideoFile"("isPresent");
CREATE INDEX "VideoFile_diskId_isPresent_idx" ON "VideoFile"("diskId", "isPresent");
