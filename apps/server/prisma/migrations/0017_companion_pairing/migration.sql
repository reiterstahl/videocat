ALTER TABLE "CompanionAgent"
ADD COLUMN "credentialHash" TEXT,
ADD COLUMN "credentialIssuedAt" TIMESTAMP(3),
ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'legacy';

CREATE UNIQUE INDEX "CompanionAgent_credentialHash_key" ON "CompanionAgent"("credentialHash");

CREATE TABLE "CompanionPairingCode" (
    "id" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedById" UUID,
    CONSTRAINT "CompanionPairingCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionPairingCode_codeHash_key" ON "CompanionPairingCode"("codeHash");
CREATE INDEX "CompanionPairingCode_expiresAt_idx" ON "CompanionPairingCode"("expiresAt");
CREATE INDEX "CompanionPairingCode_claimedAt_idx" ON "CompanionPairingCode"("claimedAt");
