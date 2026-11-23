-- CreateEnum
CREATE TYPE "AgentRunKind" AS ENUM ('audit', 'question');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AgentOutcome" AS ENUM ('answered', 'step_limit', 'token_budget', 'truncated', 'refused', 'unexpected_stop');

-- CreateEnum
CREATE TYPE "AgentStepKind" AS ENUM ('model_call', 'tool_call');

-- CreateEnum
CREATE TYPE "ExpenseFlagKind" AS ENUM ('category_not_allowed', 'over_category_cap', 'other');

-- CreateEnum
CREATE TYPE "ExpenseFlagStatus" AS ENUM ('open', 'accepted', 'dismissed');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "settlementVersion" INTEGER NOT NULL,
    "kind" "AgentRunKind" NOT NULL,
    "question" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'running',
    "outcome" "AgentOutcome",
    "finalText" TEXT,
    "errorMessage" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costNanoUsd" BIGINT DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AgentStepKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT,
    "stopReason" TEXT,
    "content" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costNanoUsd" BIGINT,
    "durationMs" INTEGER,
    "toolUseId" TEXT,
    "toolName" TEXT,
    "toolInput" JSONB,
    "toolOutput" TEXT,
    "isError" BOOLEAN,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseFlag" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "kind" "ExpenseFlagKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExpenseFlagStatus" NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_settlementId_startedAt_idx" ON "AgentRun"("settlementId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_position_key" ON "AgentStep"("runId", "position");

-- CreateIndex
CREATE INDEX "ExpenseFlag_expenseId_idx" ON "ExpenseFlag"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseFlag_agentRunId_idx" ON "ExpenseFlag"("agentRunId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseFlag" ADD CONSTRAINT "ExpenseFlag_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseFlag" ADD CONSTRAINT "ExpenseFlag_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseFlag" ADD CONSTRAINT "ExpenseFlag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
