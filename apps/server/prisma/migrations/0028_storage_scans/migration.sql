-- Drives kept by the server itself (S3 buckets) and the state of their scans.
ALTER TABLE "Disk" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'drive';
ALTER TABLE "VideoFile" ADD COLUMN "storageEtag" TEXT;
ALTER TABLE "StorageBucket" ADD COLUMN "scanRequestedAt" TIMESTAMP(3),
ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "scanStartedAt" TIMESTAMP(3),
ADD COLUMN "scanFinishedAt" TIMESTAMP(3),
ADD COLUMN "scanHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "scanProgress" JSONB,
ADD COLUMN "scanFailure" JSONB;
