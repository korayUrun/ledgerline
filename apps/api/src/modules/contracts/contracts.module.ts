import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ShowsModule } from "../shows/shows.module.js";
import { TermsController } from "./terms.controller.js";
import { TermsService } from "./terms.service.js";

// F2/F3 live here from Phase 3 (PDF upload, extraction, review). For now: manual terms.
@Module({
  imports: [AuditModule, SettlementsModule, ShowsModule],
  controllers: [TermsController],
  providers: [TermsService],
})
export class ContractsModule {}
