import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import type { AuditEntryDto } from "@ledgerline/schemas";
import { AuditService } from "./audit.service.js";

@Controller("audit")
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // GET /audit?entity=settlement&entityId=<uuid>: the history of one record, oldest first.
  @Get()
  list(
    @Query("entity") entity?: string,
    @Query("entityId") entityId?: string,
  ): Promise<AuditEntryDto[]> {
    if (!entity || !entityId) {
      throw new BadRequestException("entity and entityId query parameters are required");
    }
    return this.audit.list(entity, entityId);
  }
}
