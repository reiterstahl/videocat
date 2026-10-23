-- The last SMART check of each drive (Companion with smartctl), and the dismissed web alert.
CREATE TABLE "DiskHealth" (
    "diskId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "report" JSONB,
    "evaluation" JSONB NOT NULL,
    "alertDismissedKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiskHealth_pkey" PRIMARY KEY ("diskId")
);

ALTER TABLE "DiskHealth" ADD CONSTRAINT "DiskHealth_diskId_fkey" FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
