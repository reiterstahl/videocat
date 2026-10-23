-- Files at risk (a read that did not answer) that the web asked to read again on the next scan.
ALTER TABLE "VideoFile" ADD COLUMN "readRetryAt" TIMESTAMP(3);
