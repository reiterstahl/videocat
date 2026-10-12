-- CreateTable
CREATE TABLE "TransferGroupIgnore" (
    "destinationId" UUID NOT NULL,
    "videoFileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferGroupIgnore_pkey" PRIMARY KEY ("destinationId","videoFileId")
);

-- CreateIndex
CREATE INDEX "TransferGroupIgnore_videoFileId_idx" ON "TransferGroupIgnore"("videoFileId");

-- AddForeignKey
ALTER TABLE "TransferGroupIgnore" ADD CONSTRAINT "TransferGroupIgnore_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TransferDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferGroupIgnore" ADD CONSTRAINT "TransferGroupIgnore_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "VideoFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
