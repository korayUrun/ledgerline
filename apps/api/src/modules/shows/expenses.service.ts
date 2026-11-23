import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Expense, Prisma, PrismaClient } from "@ledgerline/db";
import type { CreateExpenseBodySchema, ExpenseDto, UpdateExpenseBody } from "@ledgerline/schemas";
import type { z } from "zod";
import type { Actor } from "../../common/actor.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { SettlementStateMachine } from "../settlements/settlement-state-machine.js";
import { RECEIPT_TYPES, ReceiptStorage } from "./receipt-storage.js";

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettlementStateMachine) private readonly stateMachine: SettlementStateMachine,
    @Inject(ReceiptStorage) private readonly receipts: ReceiptStorage,
  ) {}

  async list(showId: string): Promise<ExpenseDto[]> {
    const rows = await this.prisma.expense.findMany({
      where: { showId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toExpenseDto);
  }

  // Every write below follows the same pattern, inside one transaction:
  //   1. change the expense, 2. write the audit row, 3. mark the settlement stale.
  // If any step fails, none of them happened.

  async create(
    showId: string,
    body: z.output<typeof CreateExpenseBodySchema>,
    actor: Actor,
  ): Promise<ExpenseDto> {
    const show = await this.prisma.show.findUnique({ where: { id: showId }, select: { id: true } });
    if (!show) {
      throw new NotFoundException(`Show ${showId} not found`);
    }
    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          showId,
          category: body.category,
          description: body.description,
          amountCents: body.amountCents,
          status: body.status,
        },
      });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "expense.created",
        entity: "expense",
        entityId: created.id,
        before: null,
        after: auditFields(created),
      });
      await this.stateMachine.onInputChange(tx, showId, actor.label, "expense added");
      return created;
    });
    return toExpenseDto(expense);
  }

  async update(expenseId: string, body: UpdateExpenseBody, actor: Actor): Promise<ExpenseDto> {
    const expense = await this.prisma.$transaction(async (tx) => {
      const before = await findOrThrow(tx, expenseId);
      const updated = await tx.expense.update({
        where: { id: expenseId },
        // Copy only the fields the client sent. A missing field must stay missing
        // (= "leave as is"); Prisma's types refuse an explicit `undefined`.
        data: {
          ...(body.category !== undefined && { category: body.category }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.amountCents !== undefined && { amountCents: body.amountCents }),
          ...(body.status !== undefined && { status: body.status }),
        },
      });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "expense.updated",
        entity: "expense",
        entityId: expenseId,
        before: auditFields(before),
        after: auditFields(updated),
      });
      await this.stateMachine.onInputChange(tx, updated.showId, actor.label, "expense changed");
      return updated;
    });
    return toExpenseDto(expense);
  }

  // A hard delete. The audit row keeps what was deleted, and any settlement
  // computed with it still has the row inside its inputSnapshot.
  async remove(expenseId: string, actor: Actor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await findOrThrow(tx, expenseId);
      await tx.expense.delete({ where: { id: expenseId } });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "expense.deleted",
        entity: "expense",
        entityId: expenseId,
        before: auditFields(before),
        after: null,
      });
      await this.stateMachine.onInputChange(tx, before.showId, actor.label, "expense deleted");
    });
  }

  // A receipt is evidence, not an engine input, so attaching one does not make
  // the settlement stale.
  async attachReceipt(
    expenseId: string,
    file: { buffer: Buffer; mimetype: string } | undefined,
    actor: Actor,
  ): Promise<ExpenseDto> {
    if (!file) {
      throw new BadRequestException('Send the receipt as multipart field "file"');
    }
    if (!RECEIPT_TYPES[file.mimetype]) {
      throw new BadRequestException(`Receipts must be PDF, PNG or JPEG (got ${file.mimetype})`);
    }
    await findOrThrow(this.prisma, expenseId);
    // Written before the transaction: if the DB update then fails, we are left with
    // an unused file, which is harmless. The other order could leave a key that
    // points to no file.
    const receiptKey = await this.receipts.save(file.buffer, file.mimetype);
    const expense = await this.prisma.$transaction(async (tx) => {
      const before = await findOrThrow(tx, expenseId);
      const updated = await tx.expense.update({ where: { id: expenseId }, data: { receiptKey } });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "expense.receipt_attached",
        entity: "expense",
        entityId: expenseId,
        before: { receiptKey: before.receiptKey },
        after: { receiptKey },
      });
      return updated;
    });
    return toExpenseDto(expense);
  }

  async readReceipt(expenseId: string): Promise<{ content: Buffer; contentType: string }> {
    const expense = await findOrThrow(this.prisma, expenseId);
    if (!expense.receiptKey) {
      throw new NotFoundException("This expense has no receipt");
    }
    return {
      content: await this.receipts.read(expense.receiptKey),
      contentType: this.receipts.contentTypeOf(expense.receiptKey),
    };
  }
}

async function findOrThrow(db: Prisma.TransactionClient, expenseId: string): Promise<Expense> {
  const expense = await db.expense.findUnique({ where: { id: expenseId } });
  if (!expense) {
    throw new NotFoundException(`Expense ${expenseId} not found`);
  }
  return expense;
}

function auditFields(expense: Expense): Prisma.InputJsonObject {
  return {
    category: expense.category,
    description: expense.description,
    amountCents: expense.amountCents,
    status: expense.status,
  };
}

function toExpenseDto(expense: Expense): ExpenseDto {
  return {
    id: expense.id,
    category: expense.category,
    description: expense.description,
    amountCents: expense.amountCents,
    status: expense.status,
    hasReceipt: expense.receiptKey !== null,
    updatedAt: expense.updatedAt.toISOString(),
  };
}
