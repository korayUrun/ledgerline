import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  CreateExpenseBodySchema,
  UpdateExpenseBodySchema,
  type ExpenseDto,
  type UpdateExpenseBody,
} from "@ledgerline/schemas";
import type { z } from "zod";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ExpensesService } from "./expenses.service.js";
import { MAX_RECEIPT_BYTES } from "./receipt-storage.js";
import { ShowsService } from "./shows.service.js";

@Controller()
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(ShowsService) private readonly shows: ShowsService,
  ) {}

  @Get("shows/:showId/expenses")
  async list(@Param("showId", ParseUUIDPipe) showId: string): Promise<ExpenseDto[]> {
    await this.shows.getShow(showId);
    return this.expenses.list(showId);
  }

  // JSON body. The receipt is uploaded separately (below), so this endpoint stays
  // plain JSON and every field keeps its real type (no numbers-as-strings from a form).
  @Post("shows/:showId/expenses")
  create(
    @Param("showId", ParseUUIDPipe) showId: string,
    @Body(new ZodBodyPipe(CreateExpenseBodySchema)) body: z.output<typeof CreateExpenseBodySchema>,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseDto> {
    return this.expenses.create(showId, body, actor);
  }

  @Patch("expenses/:expenseId")
  update(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @Body(new ZodBodyPipe(UpdateExpenseBodySchema)) body: UpdateExpenseBody,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseDto> {
    return this.expenses.update(expenseId, body, actor);
  }

  @Delete("expenses/:expenseId")
  @HttpCode(204)
  async remove(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    await this.expenses.remove(expenseId, actor);
  }

  @Post("expenses/:expenseId/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  attachReceipt(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<ExpenseDto> {
    return this.expenses.attachReceipt(expenseId, file, actor);
  }

  @Get("expenses/:expenseId/receipt")
  async readReceipt(@Param("expenseId", ParseUUIDPipe) expenseId: string): Promise<StreamableFile> {
    const receipt = await this.expenses.readReceipt(expenseId);
    return new StreamableFile(receipt.content, { type: receipt.contentType });
  }
}
