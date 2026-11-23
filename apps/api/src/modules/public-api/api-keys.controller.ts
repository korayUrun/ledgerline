import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  CreateApiKeyBodySchema,
  type ApiKeyDto,
  type CreateApiKeyBody,
  type CreatedApiKeyDto,
} from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.js";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { CurrentActor } from "../auth/auth.guard.js";
import { ApiKeysService } from "./api-keys.service.js";

// Managing API keys is a person's job: these are session routes (no @ApiKeyAuth()),
// so a key cannot create more keys or un-revoke itself. Left out of the /v1 OpenAPI
// document, which describes only what an API key can call.
@ApiExcludeController()
@Controller("api-keys")
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(): Promise<ApiKeyDto[]> {
    return this.apiKeys.list();
  }

  @Post()
  create(
    @Body(new ZodBodyPipe(CreateApiKeyBodySchema)) body: CreateApiKeyBody,
    @CurrentActor() actor: Actor,
  ): Promise<CreatedApiKeyDto> {
    return this.apiKeys.create(body.name, actor);
  }

  // POST, not DELETE: the key is not deleted, it is marked revoked and kept.
  @Post(":apiKeyId/revoke")
  @HttpCode(200)
  revoke(
    @Param("apiKeyId", ParseUUIDPipe) apiKeyId: string,
    @CurrentActor() actor: Actor,
  ): Promise<ApiKeyDto> {
    return this.apiKeys.revoke(apiKeyId, actor);
  }
}
