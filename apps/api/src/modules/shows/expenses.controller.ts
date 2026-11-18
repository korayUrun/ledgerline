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
import { ActorService } from "../../common/actor.service.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ExpensesService } from "./expenses.service.js";
import { MAX_RECEIPT_BYTES } from "./receipt-storage.js";
import { ShowsService } from "./shows.service.js";

@Controller()
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(ShowsService) private readonly shows: ShowsService,
    @Inject(ActorService) private readonly actors: ActorService,
  ) {}

  @Get("shows/:showId/expenses")
  async list(@Param("showId", ParseUUIDPipe) showId: string): Promise<ExpenseDto[]> {
    await this.shows.getShow(showId);
    return this.expenses.list(showId);
  }

  // JSON body. The receipt is uploaded separately (below), so this endpoint stays
  // plain JSON and every field keeps its real type (no numbers-as-strings from a form).
  @Post("shows/:showId/expenses")
  async create(
    @Param("showId", ParseUUIDPipe) showId: string,
    @Body(new ZodBodyPipe(CreateExpenseBodySchema)) body: z.output<typeof CreateExpenseBodySchema>,
  ): Promise<ExpenseDto> {
    return this.expenses.create(showId, body, await this.actors.current());
  }

  @Patch("expenses/:expenseId")
  async update(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @Body(new ZodBodyPipe(UpdateExpenseBodySchema)) body: UpdateExpenseBody,
  ): Promise<ExpenseDto> {
    return this.expenses.update(expenseId, body, await this.actors.current());
  }

  @Delete("expenses/:expenseId")
  @HttpCode(204)
  async remove(@Param("expenseId", ParseUUIDPipe) expenseId: string): Promise<void> {
    await this.expenses.remove(expenseId, await this.actors.current());
  }

  @Post("expenses/:expenseId/receipt")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async attachReceipt(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ExpenseDto> {
    return this.expenses.attachReceipt(expenseId, file, await this.actors.current());
  }

  @Get("expenses/:expenseId/receipt")
  async readReceipt(@Param("expenseId", ParseUUIDPipe) expenseId: string): Promise<StreamableFile> {
    const receipt = await this.expenses.readReceipt(expenseId);
    return new StreamableFile(receipt.content, { type: receipt.contentType });
  }
}
