-- AlterTable
ALTER TABLE "TransferDestination" ADD COLUMN "groupKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];
