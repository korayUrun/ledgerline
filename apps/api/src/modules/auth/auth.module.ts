import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PublicApiModule } from "../public-api/public-api.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

// Login and sessions (Phase 5). APP_GUARD makes AuthGuard run before every route
// of the app, not only this module's. PublicApiModule gives the guard the API key
// check for /v1 routes (Phase 6).
@Module({
  imports: [PublicApiModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
