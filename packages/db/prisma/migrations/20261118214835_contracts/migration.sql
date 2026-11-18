-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('uploaded', 'extracting', 'needs_review', 'confirmed', 'failed');

-- AlterTable
ALTER TABLE "ContractTerms" ADD COLUMN     "contractId" TEXT;

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'uploaded',
    "extractionJson" JSONB,
    "promptVersion" TEXT,
    "llmUsage" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_showId_idx" ON "Contract"("showId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTerms" ADD CONSTRAINT "ContractTerms_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
