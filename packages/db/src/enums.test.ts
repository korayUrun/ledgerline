import {
  AgentOutcomeSchema,
  AgentRunKindSchema,
  AgentRunStatusSchema,
  AgentStepKindSchema,
  ContractStatusSchema,
  ExpenseFlagKindSchema,
  ExpenseFlagStatusSchema,
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  LineKindSchema,
  PayoutStatusSchema,
  SettlementStatusSchema,
} from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import {
  AgentOutcome,
  AgentRunKind,
  AgentRunStatus,
  AgentStepKind,
  ContractStatus,
  ExpenseCategory,
  ExpenseFlagKind,
  ExpenseFlagStatus,
  ExpenseStatus,
  PayoutStatus,
  SettlementLineKind,
  SettlementStatus,
} from "./generated/prisma/enums.js";

// The same lists are written twice: once in schema.prisma (so the database rejects
// unknown values) and once in Zod (so the engine and API reject them). This test is
// what keeps the two copies identical.
describe("Prisma enums match the Zod enums", () => {
  it("expense categories", () => {
    expect(Object.values(ExpenseCategory)).toEqual(ExpenseCategorySchema.options);
  });

  it("expense statuses", () => {
    expect(Object.values(ExpenseStatus)).toEqual(ExpenseStatusSchema.options);
  });

  it("settlement line kinds", () => {
    expect(Object.values(SettlementLineKind)).toEqual(LineKindSchema.options);
  });

  it("contract statuses", () => {
    expect(Object.values(ContractStatus)).toEqual(ContractStatusSchema.options);
  });

  it("settlement statuses", () => {
    expect(Object.values(SettlementStatus)).toEqual(SettlementStatusSchema.options);
  });

  it("payout statuses", () => {
    expect(Object.values(PayoutStatus)).toEqual(PayoutStatusSchema.options);
  });

  it("agent run kinds, statuses, outcomes and step kinds", () => {
    expect(Object.values(AgentRunKind)).toEqual(AgentRunKindSchema.options);
    expect(Object.values(AgentRunStatus)).toEqual(AgentRunStatusSchema.options);
    expect(Object.values(AgentOutcome)).toEqual(AgentOutcomeSchema.options);
    expect(Object.values(AgentStepKind)).toEqual(AgentStepKindSchema.options);
  });

  it("expense flag kinds and statuses", () => {
    expect(Object.values(ExpenseFlagKind)).toEqual(ExpenseFlagKindSchema.options);
    expect(Object.values(ExpenseFlagStatus)).toEqual(ExpenseFlagStatusSchema.options);
  });
});
