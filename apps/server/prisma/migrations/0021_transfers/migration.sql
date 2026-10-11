-- Safe transfers between drives through the Companion staging folder.

-- CreateTable
CREATE TABLE "TransferDestination" (
    "id" UUID NOT NULL,
    "diskId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferJob" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "destinationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferItem" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "videoFileId" UUID,
    "filename" TEXT NOT NULL,
    "sourceDiskId" UUID NOT NULL,
    "sourceRelativePath" TEXT NOT NULL,
    "targetDiskId" UUID NOT NULL,
    "targetFolder" TEXT NOT NULL,
    "targetRelativePath" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "expectedModifiedAt" TIMESTAMP(3),
    "sha256" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "claimedBy" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "stagedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransferDestination_nameKey_idx" ON "TransferDestination"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "TransferDestination_diskId_path_key" ON "TransferDestination"("diskId", "path");

-- CreateIndex
CREATE INDEX "TransferJob_status_idx" ON "TransferJob"("status");

-- CreateIndex
CREATE INDEX "TransferItem_jobId_idx" ON "TransferItem"("jobId");

-- CreateIndex
CREATE INDEX "TransferItem_state_idx" ON "TransferItem"("state");

-- CreateIndex
CREATE INDEX "TransferItem_sourceDiskId_state_idx" ON "TransferItem"("sourceDiskId", "state");

-- CreateIndex
CREATE INDEX "TransferItem_targetDiskId_state_idx" ON "TransferItem"("targetDiskId", "state");

-- CreateIndex
CREATE INDEX "TransferItem_videoFileId_idx" ON "TransferItem"("videoFileId");

-- AddForeignKey
ALTER TABLE "TransferDestination" ADD CONSTRAINT "TransferDestination_diskId_fkey" FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TransferDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A file can only take part in one unfinished transfer at a time.
CREATE UNIQUE INDEX "TransferItem_active_videoFile_key" ON "TransferItem"("videoFileId")
WHERE "state" NOT IN ('done', 'cancelled', 'duplicate');
