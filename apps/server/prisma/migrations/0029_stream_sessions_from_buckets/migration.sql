-- Remote playback of videos in S3 buckets: the server serves them, no Companion takes part.
ALTER TABLE "StreamSession" ALTER COLUMN "companionId" DROP NOT NULL;
ALTER TABLE "StreamSession" ADD COLUMN "storageBucketId" UUID;
