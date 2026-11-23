import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ConfirmContractBodySchema,
  type ContractDetailDto,
  type ContractDto,
  type ContractTerms,
  type TermsDto,
} from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { ShowsService } from "../shows/shows.service.js";
import { MAX_CONTRACT_BYTES } from "./contract-file-storage.js";
import { ContractsService } from "./contracts.service.js";

@Controller()
export class ContractsController {
  constructor(
    @Inject(ContractsService) private readonly contracts: ContractsService,
    @Inject(ShowsService) private readonly shows: ShowsService,
  ) {}

  // Answers 201 as soon as the PDF is stored and queued; extraction takes seconds
  // and happens in the worker. The client polls GET /contracts/:id for the status.
  @Post("shows/:showId/contracts")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CONTRACT_BYTES } }))
  async upload(
    @Param("showId", ParseUUIDPipe) showId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<ContractDto> {
    await this.shows.getShow(showId);
    return this.contracts.upload(showId, file, actor);
  }

  @Get("shows/:showId/contracts")
  async list(@Param("showId", ParseUUIDPipe) showId: string): Promise<ContractDto[]> {
    await this.shows.getShow(showId);
    return this.contracts.list(showId);
  }

  @Get("contracts/:contractId")
  get(@Param("contractId", ParseUUIDPipe) contractId: string): Promise<ContractDetailDto> {
    return this.contracts.get(contractId);
  }

  // inline: shown inside the review page, next to the fields.
  @Get("contracts/:contractId/pdf")
  async pdf(@Param("contractId", ParseUUIDPipe) contractId: string): Promise<StreamableFile> {
    const content = await this.contracts.readPdf(contractId);
    return new StreamableFile(content, { type: "application/pdf", disposition: "inline" });
  }

  // The body is the reviewed terms: ContractTermsSchema, the same rules as typed-in
  // terms. Only a person can call this; there is no agent or API-key path to it.
  @Post("contracts/:contractId/confirm")
  confirm(
    @Param("contractId", ParseUUIDPipe) contractId: string,
    @Body(new ZodBodyPipe(ConfirmContractBodySchema)) body: ContractTerms,
    @CurrentActor() actor: Actor,
  ): Promise<TermsDto> {
    return this.contracts.confirm(contractId, body, actor);
  }
}
