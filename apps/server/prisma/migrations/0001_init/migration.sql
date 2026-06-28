CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN public.unaccent('public.unaccent', $1);

CREATE TABLE "Disk" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "volumeLabel" text,
  "volumeId" text,
  "driveLetter" text,
  "totalBytes" bigint,
  "fileSystem" text,
  "firstScannedAt" timestamptz NOT NULL DEFAULT now(),
  "lastScannedAt" timestamptz NOT NULL DEFAULT now(),
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Scan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "diskId" uuid NOT NULL REFERENCES "Disk"("id") ON DELETE CASCADE,
  "rootPath" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "finishedAt" timestamptz,
  "fileCount" integer NOT NULL DEFAULT 0,
  "errorCount" integer NOT NULL DEFAULT 0
);

CREATE TABLE "VideoFile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "diskId" uuid NOT NULL REFERENCES "Disk"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "extension" text NOT NULL,
  "absolutePath" text NOT NULL,
  "relativePath" text NOT NULL,
  "sizeBytes" bigint NOT NULL,
  "fileCreatedAt" timestamptz,
  "modifiedAt" timestamptz,
  "scanStatus" text NOT NULL DEFAULT 'pending',
  "errorMessage" text,
  "durationSeconds" double precision,
  "width" integer,
  "height" integer,
  "fps" double precision,
  "videoCodec" text,
  "audioCodec" text,
  "audioChannels" integer,
  "bitrate" bigint,
  "containerFormat" text,
  "streamCount" integer,
  "ffprobeJson" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "VideoFile_disk_relative_unique" UNIQUE ("diskId", "relativePath")
);

CREATE TABLE "Thumbnail" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "videoFileId" uuid NOT NULL REFERENCES "VideoFile"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "timestampSeconds" double precision,
  "relativePath" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Thumbnail_video_kind_unique" UNIQUE ("videoFileId", "kind")
);

CREATE INDEX "Disk_name_idx" ON "Disk"("name");
CREATE INDEX "Disk_volumeId_idx" ON "Disk"("volumeId");
CREATE INDEX "Scan_diskId_idx" ON "Scan"("diskId");
CREATE INDEX "Scan_status_idx" ON "Scan"("status");
CREATE INDEX "VideoFile_diskId_idx" ON "VideoFile"("diskId");
CREATE INDEX "VideoFile_sizeBytes_idx" ON "VideoFile"("sizeBytes");
CREATE INDEX "VideoFile_extension_idx" ON "VideoFile"("extension");
CREATE INDEX "VideoFile_durationSeconds_idx" ON "VideoFile"("durationSeconds");
CREATE INDEX "VideoFile_width_idx" ON "VideoFile"("width");
CREATE INDEX "VideoFile_height_idx" ON "VideoFile"("height");
CREATE INDEX "VideoFile_videoCodec_idx" ON "VideoFile"("videoCodec");
CREATE INDEX "VideoFile_modifiedAt_idx" ON "VideoFile"("modifiedAt");
CREATE INDEX "Thumbnail_videoFileId_idx" ON "Thumbnail"("videoFileId");

CREATE INDEX "VideoFile_filename_trgm_idx"
  ON "VideoFile" USING gin (lower(immutable_unaccent("filename")) gin_trgm_ops);

CREATE INDEX "VideoFile_relativePath_trgm_idx"
  ON "VideoFile" USING gin (lower(immutable_unaccent("relativePath")) gin_trgm_ops);
