-- CreateTable
CREATE TABLE "TransferTagRule" (
    "id" UUID NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "destinationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferTagRule_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "TransferJob" ADD COLUMN "tagRuleId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "TransferTagRule_categoryKey_key" ON "TransferTagRule"("categoryKey");

-- AddForeignKey
ALTER TABLE "TransferTagRule" ADD CONSTRAINT "TransferTagRule_categoryKey_fkey" FOREIGN KEY ("categoryKey") REFERENCES "CurationCategory"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferTagRule" ADD CONSTRAINT "TransferTagRule_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "TransferDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferJob" ADD CONSTRAINT "TransferJob_tagRuleId_fkey" FOREIGN KEY ("tagRuleId") REFERENCES "TransferTagRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
