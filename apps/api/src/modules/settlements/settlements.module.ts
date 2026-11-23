import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementStateMachine } from "./settlement-state-machine.js";
import { SettlementsController } from "./settlements.controller.js";
import { SettlementsService } from "./settlements.service.js";

@Module({
  imports: [AuditModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementStateMachine],
  // The state machine, so the input-changing modules (shows, contracts) can mark
  // settlements stale; the service, so the agent reads a settlement the same way the
  // worksheet does (with the drift check).
  exports: [SettlementStateMachine, SettlementsService],
})
export class SettlementsModule {}
