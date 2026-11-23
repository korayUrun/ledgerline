import { Controller, Get, Inject } from "@nestjs/common";
import type { V1ShowList } from "@ledgerline/schemas";
import { ApiKeyAuth } from "../auth/auth.guard.js";
import { PublicApiService } from "./public-api.service.js";

// The public API (F9): what the MCP server and other tools call with an API key.
// Read-mostly by design. There is no approve or pay route here, and there must never
// be one: those need a person (a session), which an API key is not.
@ApiKeyAuth()
@Controller("v1")
export class V1Controller {
  constructor(@Inject(PublicApiService) private readonly publicApi: PublicApiService) {}

  @Get("shows")
  listShows(): Promise<V1ShowList> {
    return this.publicApi.listShows();
  }
}
