-- AlterEnum
ALTER TYPE "AgentRunKind" ADD VALUE 'workspace';

-- AlterTable
ALTER TABLE "AgentRun" ALTER COLUMN "settlementId" DROP NOT NULL,
ALTER COLUMN "settlementVersion" DROP NOT NULL;

-- A run is about one settlement (audit, question: both columns set) or about the
-- whole workspace (both null). Never one without the other. Written by hand:
-- Prisma's schema language has no CHECK constraints.
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_settlement_pair"
  CHECK (("settlementId" IS NULL) = ("settlementVersion" IS NULL));
