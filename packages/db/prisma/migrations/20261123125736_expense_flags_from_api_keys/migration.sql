-- AlterTable
ALTER TABLE "ExpenseFlag" ADD COLUMN     "apiKeyId" TEXT,
ALTER COLUMN "agentRunId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ExpenseFlag_apiKeyId_idx" ON "ExpenseFlag"("apiKeyId");

-- AddForeignKey
ALTER TABLE "ExpenseFlag" ADD CONSTRAINT "ExpenseFlag_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A flag has exactly one source: the agent run that opened it, or the API key.
-- Prisma's schema language has no CHECK constraints, so it is written by hand here.
ALTER TABLE "ExpenseFlag" ADD CONSTRAINT "ExpenseFlag_one_source"
  CHECK (("agentRunId" IS NULL) <> ("apiKeyId" IS NULL));
