CREATE TABLE "VideoFileCategory" (
  "videoFileId" UUID NOT NULL,
  "categoryKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VideoFileCategory_pkey" PRIMARY KEY ("videoFileId", "categoryKey")
);

CREATE INDEX "VideoFileCategory_categoryKey_idx" ON "VideoFileCategory"("categoryKey");
CREATE INDEX "VideoFileCategory_videoFileId_idx" ON "VideoFileCategory"("videoFileId");

ALTER TABLE "VideoFileCategory"
  ADD CONSTRAINT "VideoFileCategory_videoFileId_fkey"
  FOREIGN KEY ("videoFileId") REFERENCES "VideoFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoFileCategory"
  ADD CONSTRAINT "VideoFileCategory_categoryKey_fkey"
  FOREIGN KEY ("categoryKey") REFERENCES "CurationCategory"("key") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "VideoFileCategory" ("videoFileId", "categoryKey")
SELECT "id", "curationStatus"
FROM "VideoFile"
WHERE "curationStatus" <> 'none'
ON CONFLICT DO NOTHING;
