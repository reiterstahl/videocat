-- S3-compatible buckets catalogued like drives. The secret key is stored sealed (AES-256-GCM).
CREATE TABLE "StorageBucket" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "forcePathStyle" BOOLEAN NOT NULL DEFAULT true,
    "accessKeyId" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL DEFAULT '',
    "diskId" UUID,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckOk" BOOLEAN,
    "lastCheckFailure" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageBucket_diskId_key" ON "StorageBucket"("diskId");

ALTER TABLE "StorageBucket" ADD CONSTRAINT "StorageBucket_diskId_fkey" FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
