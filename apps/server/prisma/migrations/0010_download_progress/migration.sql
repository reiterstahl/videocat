ALTER TABLE "DownloadQueue"
  ADD COLUMN "progressBytes" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "progressUpdatedAt" timestamp(3);
