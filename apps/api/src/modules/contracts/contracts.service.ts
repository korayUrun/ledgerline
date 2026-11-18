import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import {
  ContractExtractionSchema,
  draftToContractTerms,
  extractionToDraft,
  type ContractDetailDto,
  type ContractDto,
  type ContractTerms,
  type TermsDto,
} from "@ledgerline/schemas";
import type { Actor } from "../../common/actor.service.js";
import { canonicalJson } from "../../common/canonical-json.js";
import { PRISMA } from "../../common/tokens.js";
import { AuditService } from "../audit/audit.service.js";
import { ContractFileStorage, looksLikePdf } from "./contract-file-storage.js";
import { ContractStateMachine } from "./contract-state-machine.js";
import { toContractDetailDto, toContractDto } from "./contract-dto.js";
import { ExtractionQueue } from "./extraction/extraction-queue.js";
import { TermsService } from "./terms.service.js";

// Upload (F2) and review (F3). The extraction itself runs in the worker.
@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ContractStateMachine) private readonly stateMachine: ContractStateMachine,
    @Inject(ContractFileStorage) private readonly storage: ContractFileStorage,
    @Inject(ExtractionQueue) private readonly queue: ExtractionQueue,
    @Inject(TermsService) private readonly terms: TermsService,
  ) {}

  async upload(
    showId: string,
    file: Express.Multer.File | undefined,
    actor: Actor,
  ): Promise<ContractDto> {
    if (!file) {
      throw new BadRequestException('Send the contract as a multipart field named "file".');
    }
    if (!looksLikePdf(file.buffer)) {
      throw new BadRequestException("The contract must be a PDF file.");
    }

    const fileKey = await this.storage.save(file.buffer);
    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: { showId, fileKey, fileName: file.originalname.slice(0, 200) },
      });
      await this.audit.record(tx, {
        actor: actor.label,
        action: "contract.uploaded",
        entity: "contract",
        entityId: created.id,
        before: null,
        after: { status: created.status, showId, fileName: created.fileName },
      });
      return created;
    });

    // Enqueued after the commit, so the worker can never pick up a job for a
    // contract it cannot read yet. If Redis is down at this exact moment, the
    // contract stays "uploaded" and the user is told to upload again.
    try {
      await this.queue.enqueue(contract.id);
    } catch (error) {
      this.logger.error(`could not enqueue contract ${contract.id}`, error);
      throw new ServiceUnavailableException(
        "The contract was saved, but extraction could not be started. Upload it again in a moment.",
      );
    }
    return toContractDto(contract);
  }

  async list(showId: string): Promise<ContractDto[]> {
    const rows = await this.prisma.contract.findMany({
      where: { showId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toContractDto);
  }

  async get(contractId: string): Promise<ContractDetailDto> {
    return toContractDetailDto(await this.findOrThrow(contractId));
  }

  async readPdf(contractId: string): Promise<Buffer> {
    const contract = await this.findOrThrow(contractId);
    return this.storage.read(contract.fileKey);
  }

  // needs_review → confirmed, and the reviewed terms become a new ContractTerms
  // version. One transaction: the version, the status change, both audit rows and
  // the "settlement is stale" mark all commit together or not at all.
  async confirm(contractId: string, terms: ContractTerms, actor: Actor): Promise<TermsDto> {
    const contract = await this.findOrThrow(contractId);
    await this.prisma.$transaction(async (tx) => {
      // First, so a contract that is not in review is refused (409) before
      // anything is written.
      await this.stateMachine.transition(tx, {
        contract,
        to: "confirmed",
        actor: actor.label,
        action: "contract.confirmed",
        details: { reviewerEdited: this.reviewerEdited(contract.extractionJson, terms) },
      });
      await this.terms.createVersion(tx, {
        showId: contract.showId,
        terms,
        actor,
        contractId: contract.id,
      });
    });
    return this.terms.get(contract.showId);
  }

  // Did the reviewer change anything Claude extracted (or fill in a gap)? Kept in
  // the audit log, so we can later count how often humans correct the model.
  private reviewerEdited(extractionJson: unknown, confirmed: ContractTerms): boolean {
    const extraction = ContractExtractionSchema.safeParse(extractionJson);
    if (!extraction.success) return true;
    const proposed = draftToContractTerms(extractionToDraft(extraction.data));
    return !proposed.success || canonicalJson(proposed.terms) !== canonicalJson(confirmed);
  }

  private async findOrThrow(contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) {
      throw new NotFoundException(`Contract ${contractId} not found`);
    }
    return contract;
  }
}
