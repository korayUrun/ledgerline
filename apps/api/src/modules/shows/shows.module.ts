import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ExpensesController } from "./expenses.controller.js";
import { ExpensesService } from "./expenses.service.js";
import { ReceiptStorage } from "./receipt-storage.js";
import { ShowsController } from "./shows.controller.js";
import { ShowsService } from "./shows.service.js";
import { TicketSalesController } from "./ticket-sales.controller.js";
import { TicketSalesService } from "./ticket-sales.service.js";

// F1: venues, artists, shows and their inputs (ticket sales, expenses).
@Module({
  imports: [AuditModule, SettlementsModule],
  controllers: [ShowsController, TicketSalesController, ExpensesController],
  providers: [ShowsService, TicketSalesService, ExpensesService, ReceiptStorage],
  exports: [ShowsService],
})
export class ShowsModule {}
