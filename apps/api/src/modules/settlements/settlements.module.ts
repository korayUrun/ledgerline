import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementStateMachine } from "./settlement-state-machine.js";
import { SettlementsController } from "./settlements.controller.js";
import { SettlementsService } from "./settlements.service.js";

@Module({
  imports: [AuditModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementStateMachine],
  // Exported so the input-changing modules (shows, contracts) can mark settlements stale.
  exports: [SettlementStateMachine],
})
export class SettlementsModule {}
