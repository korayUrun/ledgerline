import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { TicketSaleDto } from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { ShowsService } from "./shows.service.js";
import { TicketSalesService } from "./ticket-sales.service.js";

// 1 MB is thousands of tiers; anything bigger is a mistake (or an attack).
const MAX_CSV_BYTES = 1024 * 1024;

@Controller("shows/:showId/ticket-sales")
export class TicketSalesController {
  constructor(
    @Inject(TicketSalesService) private readonly ticketSales: TicketSalesService,
    @Inject(ShowsService) private readonly shows: ShowsService,
  ) {}

  @Get()
  async list(@Param("showId", ParseUUIDPipe) showId: string): Promise<TicketSaleDto[]> {
    await this.shows.getShow(showId); // 404 for an unknown show, rather than []
    return this.ticketSales.list(showId);
  }

  // multipart/form-data with the CSV in field "file". FileInterceptor (multer)
  // keeps the upload in memory, which is fine at this size limit.
  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_BYTES } }))
  async import(
    @Param("showId", ParseUUIDPipe) showId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<TicketSaleDto[]> {
    if (!file) {
      throw new BadRequestException('Send the CSV as multipart field "file"');
    }
    await this.shows.getShow(showId);
    return this.ticketSales.importCsv(showId, file.buffer.toString("utf8"), actor);
  }
}
