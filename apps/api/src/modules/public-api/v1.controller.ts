import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Res,
} from "@nestjs/common";
import {
  V1FlagExpenseBodySchema,
  type V1ExpenseFlag,
  type V1FlagExpenseBody,
  type V1LineExplanation,
  type V1Settlement,
  type V1ShowList,
} from "@ledgerline/schemas";
import type { ApiKeyActor } from "../../common/actor.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ApiKeyAuth, CurrentApiKey } from "../auth/auth.guard.js";
import { PublicApiService } from "./public-api.service.js";

type StatusResponse = { status(code: number): unknown };

// The public API (F9): what the MCP server and other tools call with an API key.
// Read-mostly by design: the only write is a flag, which is a note for a person.
// There is no approve or pay route here, and there must never be one: those need a
// person (a session), which an API key is not.
@ApiKeyAuth()
@Controller("v1")
export class V1Controller {
  constructor(@Inject(PublicApiService) private readonly publicApi: PublicApiService) {}

  @Get("shows")
  listShows(): Promise<V1ShowList> {
    return this.publicApi.listShows();
  }

  // The settlement with its worksheet lines and payment attempts.
  @Get("settlements/:settlementId")
  getSettlement(@Param("settlementId", ParseUUIDPipe) settlementId: string): Promise<V1Settlement> {
    return this.publicApi.getSettlement(settlementId);
  }

  // One line with the input rows and contract clause it comes from.
  @Get("settlements/:settlementId/lines/:position")
  explainLine(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Param("position", ParseIntPipe) position: number,
  ): Promise<V1LineExplanation> {
    return this.publicApi.explainLine(settlementId, position);
  }

  // 201 for a new flag, 200 when the same open flag already existed (it is returned,
  // not duplicated). passthrough: Nest still sends the returned body as JSON.
  @Post("expenses/:expenseId/flags")
  async flagExpense(
    @Param("expenseId", ParseUUIDPipe) expenseId: string,
    @Body(new ZodBodyPipe(V1FlagExpenseBodySchema)) body: V1FlagExpenseBody,
    @CurrentApiKey() apiKey: ApiKeyActor,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<V1ExpenseFlag> {
    const flag = await this.publicApi.flagExpense(expenseId, body, apiKey);
    response.status(flag.created ? 201 : 200);
    return flag;
  }
}
