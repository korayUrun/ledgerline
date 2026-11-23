import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApiKey, PrismaClient } from "@ledgerline/db";
import type { ApiKeyDto, CreatedApiKeyDto } from "@ledgerline/schemas";
import { apiKeyActor, type Actor, type ApiKeyActor } from "../../common/actor.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { hashApiKey, looksLikeApiKey, newApiKey } from "./api-key-secret.js";

// lastUsedAt is written at most once a minute per key: a client making many calls
// should not turn every read into a database write.
const LAST_USED_RESOLUTION_MS = 60_000;

// API keys for the public /v1 API (F9). A person creates and revokes them (session
// routes in ApiKeysController); the AuthGuard checks them on /v1 routes.
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // The only time the full key exists outside the client: it is returned here and
  // then forgotten. The database gets its hash.
  async create(name: string, actor: Actor): Promise<CreatedApiKeyDto> {
    const { key, prefix, keyHash } = newApiKey();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: { name, prefix, keyHash, createdById: actor.userId },
        include: { createdBy: { select: { name: true } } },
      });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "api_key.created",
        entity: "api_key",
        entityId: created.id,
        before: null,
        after: { name, prefix }, // never the key or its hash
      });
      return created;
    });
    return { apiKey: toApiKeyDto(row), key };
  }

  // One venue organization (CLAUDE.md scope), so every logged-in person sees every
  // key. Newest first.
  async list(): Promise<ApiKeyDto[]> {
    const rows = await this.prisma.apiKey.findMany({
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toApiKeyDto);
  }

  // Takes effect on the next request: actorForKey reads the row every time, nothing
  // is cached. The row is kept so the audit log still points to something.
  async revoke(apiKeyId: string, actor: Actor): Promise<ApiKeyDto> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.apiKey.findUnique({ where: { id: apiKeyId } });
      if (!existing) {
        throw new NotFoundException(`API key ${apiKeyId} not found`);
      }
      // Compare-and-set: of two revokes at once, exactly one writes revokedAt.
      const { count } = await tx.apiKey.updateMany({
        where: { id: apiKeyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException("This API key is already revoked.");
      }
      await this.audit.record(tx, {
        actor: actor.label,
        action: "api_key.revoked",
        entity: "api_key",
        entityId: apiKeyId,
        before: { revokedAt: null },
        after: { revoked: true },
      });
      const revoked = await tx.apiKey.findUniqueOrThrow({
        where: { id: apiKeyId },
        include: { createdBy: { select: { name: true } } },
      });
      return toApiKeyDto(revoked);
    });
  }

  // The key behind a bearer token, or null when it is malformed, unknown or revoked.
  // Called by the AuthGuard on every /v1 request.
  async actorForKey(token: string): Promise<ApiKeyActor | null> {
    if (!looksLikeApiKey(token)) {
      return null;
    }
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
    if (!key || key.revokedAt !== null) {
      return null;
    }
    await this.touch(key);
    return apiKeyActor(key.id);
  }

  // One conditional UPDATE: if two requests arrive together, both may match, and both
  // write nearly the same time. Harmless, and cheaper than locking.
  private async touch(key: ApiKey): Promise<void> {
    const staleBefore = new Date(Date.now() - LAST_USED_RESOLUTION_MS);
    if (key.lastUsedAt !== null && key.lastUsedAt > staleBefore) {
      return;
    }
    await this.prisma.apiKey.updateMany({
      where: { id: key.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }] },
      data: { lastUsedAt: new Date() },
    });
  }
}

function toApiKeyDto(row: ApiKey & { createdBy: { name: string } }): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
