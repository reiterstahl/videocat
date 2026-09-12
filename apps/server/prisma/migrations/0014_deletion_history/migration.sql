CREATE TABLE "DeletionRecord" (
    "id" UUID NOT NULL,
    "videoFileId" UUID NOT NULL,
    "diskId" UUID,
    "diskName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'review',
    "requestedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "companionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeletionRecord_videoFileId_key" ON "DeletionRecord"("videoFileId");
CREATE INDEX "DeletionRecord_diskId_idx" ON "DeletionRecord"("diskId");
CREATE INDEX "DeletionRecord_status_idx" ON "DeletionRecord"("status");
CREATE INDEX "DeletionRecord_attemptedAt_idx" ON "DeletionRecord"("attemptedAt");
CREATE INDEX "DeletionRecord_completedAt_idx" ON "DeletionRecord"("completedAt");

ALTER TABLE "DeletionRecord"
ADD CONSTRAINT "DeletionRecord_diskId_fkey"
FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
