CREATE TABLE "StreamSession" (
    "id" UUID NOT NULL,
    "videoFileId" UUID NOT NULL,
    "companionId" UUID NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'opening',
    "fileSizeBytes" BIGINT,
    "mimeType" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastAccessedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StreamSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StreamSession"
ADD CONSTRAINT "StreamSession_videoFileId_fkey"
FOREIGN KEY ("videoFileId") REFERENCES "VideoFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "StreamSession_videoFileId_idx" ON "StreamSession"("videoFileId");
CREATE INDEX "StreamSession_companionId_status_idx" ON "StreamSession"("companionId", "status");
CREATE INDEX "StreamSession_expiresAt_idx" ON "StreamSession"("expiresAt");
