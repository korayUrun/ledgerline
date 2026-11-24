import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { AgentTraceService } from "./agent-trace.service.js";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";
import { AuditContextLoader } from "./audit-context-loader.js";
import { ExpenseFlagsService } from "./expense-flags.service.js";
import { WorkspaceContextLoader } from "./workspace/workspace-context-loader.js";

// F6 audit agent, the workspace assistant, and their traces (F12). The LlmClient
// comes from AppModule (global).
@Module({
  imports: [AuditModule, SettlementsModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    AuditContextLoader,
    WorkspaceContextLoader,
    AgentTraceService,
    ExpenseFlagsService,
  ],
  exports: [AgentTraceService, ExpenseFlagsService],
})
export class AgentModule {}
