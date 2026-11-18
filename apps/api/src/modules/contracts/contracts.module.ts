import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ShowsModule } from "../shows/shows.module.js";
import { ContractFileStorage } from "./contract-file-storage.js";
import { ContractStateMachine } from "./contract-state-machine.js";
import { ContractsController } from "./contracts.controller.js";
import { ContractsService } from "./contracts.service.js";
import { ExtractionQueue } from "./extraction/extraction-queue.js";
import { TermsController } from "./terms.controller.js";
import { TermsService } from "./terms.service.js";

// F2/F3 on the HTTP side: upload a PDF, read the extraction, confirm the terms,
// and hand-entered terms. The extraction itself runs in the worker (worker.module.ts).
@Module({
  imports: [AuditModule, SettlementsModule, ShowsModule],
  controllers: [TermsController, ContractsController],
  providers: [
    TermsService,
    ContractsService,
    ContractStateMachine,
    ContractFileStorage,
    ExtractionQueue,
  ],
})
export class ContractsModule {}
