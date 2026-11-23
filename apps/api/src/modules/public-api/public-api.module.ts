import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeysService } from "./api-keys.service.js";
import { PublicApiService } from "./public-api.service.js";
import { V1Controller } from "./v1.controller.js";

// F9: API keys and the /v1 routes. Exports ApiKeysService for the AuthGuard, which
// checks the key on every /v1 request.
@Module({
  imports: [AuditModule],
  controllers: [ApiKeysController, V1Controller],
  providers: [ApiKeysService, PublicApiService],
  exports: [ApiKeysService],
})
export class PublicApiModule {}
