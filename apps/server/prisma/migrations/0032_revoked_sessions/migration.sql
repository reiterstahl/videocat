-- Sessions closed with Salir, until their token would have expired.
CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
