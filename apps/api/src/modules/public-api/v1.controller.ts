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
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  type ApiParamOptions,
} from "@nestjs/swagger";
import {
  V1ErrorSchema,
  V1ExpenseFlagSchema,
  V1FlagExpenseBodySchema,
  V1LineExplanationSchema,
  V1SettlementSchema,
  V1ShowListSchema,
  type V1ExpenseFlag,
  type V1FlagExpenseBody,
  type V1LineExplanation,
  type V1Settlement,
  type V1ShowList,
} from "@ledgerline/schemas";
import type { ApiKeyActor } from "../../common/actor.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ApiKeyAuth, CurrentApiKey } from "../auth/auth.guard.js";
import { requestBodySchema } from "./openapi-schema.js";
import { PublicApiService } from "./public-api.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

type StatusResponse = { status(code: number): unknown };

// Path parameters are described by hand: the app runs through tsx (esbuild), which
// does not emit the TypeScript type metadata Swagger would otherwise read.
const SETTLEMENT_ID: ApiParamOptions = {
  name: "settlementId",
  schema: { type: "string", format: "uuid" },
  description: "From GET /v1/shows (settlement.id)",
};

// The public API (F9): what the MCP server and other tools call with an API key.
// Read-mostly by design: the only write is a flag, which is a note for a person.
// There is no approve or pay route here, and there must never be one: those need a
// person (a session), which an API key is not.
// Rate-limited per key (RateLimitGuard, after the global AuthGuard found the key).
// The Api* decorators only describe the routes for the OpenAPI document (openapi.ts).
@ApiKeyAuth()
@UseGuards(RateLimitGuard)
@ApiTags("v1")
@ApiBearerAuth("apiKey")
@ApiResponse({
  status: 401,
  description: "Missing, unknown or revoked API key",
  standardSchema: V1ErrorSchema,
})
@ApiResponse({
  status: 429,
  description: "Rate limit reached; the Retry-After header says how many seconds to wait",
  standardSchema: V1ErrorSchema,
})
@Controller("v1")
export class V1Controller {
  constructor(@Inject(PublicApiService) private readonly publicApi: PublicApiService) {}

  @Get("shows")
  @ApiOperation({
    summary: "List shows",
    description:
      "Every show, newest first, with its settlement id, status and payout (null until computed).",
  })
  @ApiOkResponse({ standardSchema: V1ShowListSchema })
  listShows(): Promise<V1ShowList> {
    return this.publicApi.listShows();
  }

  @Get("settlements/:settlementId")
  @ApiOperation({
    summary: "Get a settlement",
    description:
      "The settlement with its worksheet lines in order (the last line is the total payout), its payment attempts and the number of open expense flags. Status `stale` means the inputs changed after the compute and the lines are out of date.",
  })
  @ApiParam(SETTLEMENT_ID)
  @ApiOkResponse({ standardSchema: V1SettlementSchema })
  @ApiResponse({ status: 404, description: "Unknown settlement", standardSchema: V1ErrorSchema })
  getSettlement(@Param("settlementId", ParseUUIDPipe) settlementId: string): Promise<V1Settlement> {
    return this.publicApi.getSettlement(settlementId);
  }

  @Get("settlements/:settlementId/lines/:position")
  @ApiOperation({
    summary: "Explain one worksheet line",
    description:
      "The line with the input rows it was computed from (ticket tiers or expenses, as they were at compute time) and the contract clause behind it: the confirmed terms, plus the contract's own words when the terms were read from the PDF.",
  })
  @ApiParam(SETTLEMENT_ID)
  @ApiParam({
    name: "position",
    schema: { type: "integer", minimum: 0 },
    description: "The line's position, from GET /v1/settlements/{settlementId}",
  })
  @ApiOkResponse({ standardSchema: V1LineExplanationSchema })
  @ApiResponse({
    status: 404,
    description: "Unknown settlement, or no line at this position",
    standardSchema: V1ErrorSchema,
  })
  @ApiResponse({ status: 409, description: "Not computed yet", standardSchema: V1ErrorSchema })
  explainLine(
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Param("position", ParseIntPipe) position: number,
  ): Promise<V1LineExplanation> {
    return this.publicApi.explainLine(settlementId, position);
  }

  // 201 for a new flag, 200 when the same open flag already existed (it is returned,
  // not duplicated). passthrough: Nest still sends the returned body as JSON.
  @Post("expenses/:expenseId/flags")
  @ApiOperation({
    summary: "Flag an expense for review",
    description:
      "Opens a note on an expense for a person to accept or dismiss. It changes neither the expense nor the payout. Flagging the same expense with the same kind again returns the open flag instead of a second one.",
  })
  @ApiParam({ name: "expenseId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: requestBodySchema(V1FlagExpenseBodySchema) })
  @ApiCreatedResponse({ description: "A new flag", standardSchema: V1ExpenseFlagSchema })
  @ApiOkResponse({ description: "The same open flag", standardSchema: V1ExpenseFlagSchema })
  @ApiResponse({ status: 400, description: "Invalid body", standardSchema: V1ErrorSchema })
  @ApiResponse({ status: 404, description: "Unknown expense", standardSchema: V1ErrorSchema })
  @ApiResponse({
    status: 409,
    description: "The settlement is approved: its expenses can no longer be flagged",
    standardSchema: V1ErrorSchema,
  })
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
