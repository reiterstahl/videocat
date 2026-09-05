CREATE TABLE "CompanionAgent" (
  "installationId" uuid PRIMARY KEY,
  "name" text,
  "version" integer NOT NULL DEFAULT 0,
  "mountedDiskCount" integer NOT NULL DEFAULT 0,
  "mountedDiskIds" jsonb,
  "capabilities" jsonb,
  "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
  "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "CompanionAgent_lastSeenAt_idx" ON "CompanionAgent"("lastSeenAt");
CREATE INDEX "CompanionAgent_revokedAt_idx" ON "CompanionAgent"("revokedAt");
