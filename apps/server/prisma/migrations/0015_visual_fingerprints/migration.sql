ALTER TABLE "VideoFile"
ADD COLUMN "visualFingerprint" TEXT,
ADD COLUMN "fingerprintVersion" INTEGER,
ADD COLUMN "fingerprintedAt" TIMESTAMP(3);

CREATE INDEX "VideoFile_fingerprintVersion_idx" ON "VideoFile"("fingerprintVersion");
