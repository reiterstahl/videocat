CREATE TABLE "DownloadQueue" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "videoFileId" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "source" text NOT NULL DEFAULT 'manual',
  "requestedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" timestamp(3),
  "completedAt" timestamp(3),
  "destinationPath" text,
  "downloadedTag" text,
  "errorMessage" text,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownloadQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DownloadQueue_videoFileId_key" ON "DownloadQueue"("videoFileId");
CREATE INDEX "DownloadQueue_status_idx" ON "DownloadQueue"("status");
CREATE INDEX "DownloadQueue_requestedAt_idx" ON "DownloadQueue"("requestedAt");
CREATE INDEX "DownloadQueue_completedAt_idx" ON "DownloadQueue"("completedAt");
CREATE INDEX "DownloadQueue_source_idx" ON "DownloadQueue"("source");

ALTER TABLE "DownloadQueue"
  ADD CONSTRAINT "DownloadQueue_videoFileId_fkey"
  FOREIGN KEY ("videoFileId") REFERENCES "VideoFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "CurationCategory" ("key", "label", "color", "builtIn", "updatedAt")
VALUES ('download', 'A descargar', '#FC6121', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label",
    "color" = EXCLUDED."color",
    "builtIn" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
