ALTER TABLE "VideoFile"
  ADD COLUMN "folderSizeBytes" BIGINT;

CREATE INDEX "VideoFile_folderSizeBytes_idx" ON "VideoFile"("folderSizeBytes");

CREATE TABLE "AgentError" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "diskId" UUID NOT NULL,
  "scanId" UUID,
  "category" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "code" TEXT,
  "message" TEXT NOT NULL,
  "absolutePath" TEXT,
  "relativePath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentError_diskId_idx" ON "AgentError"("diskId");
CREATE INDEX "AgentError_scanId_idx" ON "AgentError"("scanId");
CREATE INDEX "AgentError_category_idx" ON "AgentError"("category");
CREATE INDEX "AgentError_phase_idx" ON "AgentError"("phase");
CREATE INDEX "AgentError_createdAt_idx" ON "AgentError"("createdAt");

ALTER TABLE "AgentError"
  ADD CONSTRAINT "AgentError_diskId_fkey"
  FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentError"
  ADD CONSTRAINT "AgentError_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
