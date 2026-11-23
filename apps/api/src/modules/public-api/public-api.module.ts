import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { SettlementsModule } from "../settlements/settlements.module.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeysService } from "./api-keys.service.js";
import { PublicApiService } from "./public-api.service.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimiter } from "./rate-limiter.js";
import { V1Controller } from "./v1.controller.js";

// F9: API keys and the /v1 routes. Exports ApiKeysService for the AuthGuard, which
// checks the key on every /v1 request.
@Module({
  imports: [AuditModule, SettlementsModule, AgentModule],
  controllers: [ApiKeysController, V1Controller],
  providers: [ApiKeysService, PublicApiService, RateLimiter, RateLimitGuard],
  exports: [ApiKeysService],
})
export class PublicApiModule {}
