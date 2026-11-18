import {
  ContractStatusSchema,
  ExpenseCategorySchema,
  ExpenseStatusSchema,
  LineKindSchema,
  SettlementStatusSchema,
} from "@ledgerline/schemas";
import { describe, expect, it } from "vitest";
import {
  ContractStatus,
  ExpenseCategory,
  ExpenseStatus,
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
});
