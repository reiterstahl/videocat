ALTER TABLE "Scan"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "Scan_diskId_rootPath_status_leaseExpiresAt_idx"
  ON "Scan"("diskId", "rootPath", "status", "leaseExpiresAt");
CREATE INDEX "Scan_diskId_rootPath_generation_idx"
  ON "Scan"("diskId", "rootPath", "generation");

CREATE INDEX "VideoFile_diskId_isPresent_curationStatus_idx"
  ON "VideoFile"("diskId", "isPresent", "curationStatus");
CREATE INDEX "VideoFile_isPresent_curationStatus_reviewedAt_idx"
  ON "VideoFile"("isPresent", "curationStatus", "reviewedAt");

CREATE TABLE "ActionAudit" (
  "id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'started',
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "requestId" TEXT,
  "idempotencyKey" TEXT,
  "diskId" UUID,
  "videoFileId" UUID,
  "target" TEXT,
  "metadata" JSONB,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActionAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActionAudit_idempotencyKey_key" ON "ActionAudit"("idempotencyKey");
CREATE INDEX "ActionAudit_action_createdAt_idx" ON "ActionAudit"("action", "createdAt");
CREATE INDEX "ActionAudit_status_createdAt_idx" ON "ActionAudit"("status", "createdAt");
CREATE INDEX "ActionAudit_diskId_createdAt_idx" ON "ActionAudit"("diskId", "createdAt");
CREATE INDEX "ActionAudit_videoFileId_createdAt_idx" ON "ActionAudit"("videoFileId", "createdAt");
CREATE INDEX "ActionAudit_actorType_actorId_createdAt_idx" ON "ActionAudit"("actorType", "actorId", "createdAt");
