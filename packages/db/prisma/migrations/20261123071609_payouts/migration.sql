-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SettlementStatus" ADD VALUE 'approved';
ALTER TYPE "SettlementStatus" ADD VALUE 'paying';
ALTER TYPE "SettlementStatus" ADD VALUE 'paid';
ALTER TYPE "SettlementStatus" ADD VALUE 'payment_failed';

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "settlementVersion" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "stripeTransferId" TEXT,
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_stripeTransferId_key" ON "Payout"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_settlementId_attempt_key" ON "Payout"("settlementId", "attempt");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
