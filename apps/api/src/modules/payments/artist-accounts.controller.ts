import {
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PrismaClient } from "@ledgerline/db";
import type { StripeOnboardingDto } from "@ledgerline/schemas";
import { CONFIG, PAYMENT_GATEWAY, PRISMA } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import { PaymentConfigError, PaymentRefusedError, type PaymentGateway } from "./payment-gateway.js";

// Sets up the artist's Stripe connected account (test mode), where payouts go.
// Creates the account the first time, then returns a Stripe-hosted onboarding link
// where the details are filled in (test data in test mode).
@Controller("artists/:artistId/stripe-account")
export class ArtistAccountsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async onboard(@Param("artistId", ParseUUIDPipe) artistId: string): Promise<StripeOnboardingDto> {
    if (this.gateway === null) {
      throw new ServiceUnavailableException("Payments are not configured (STRIPE_SECRET_KEY).");
    }
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) {
      throw new NotFoundException(`Artist ${artistId} not found`);
    }
    try {
      let accountId = artist.stripeAccountId;
      if (accountId === null) {
        const created = await this.gateway.createConnectedAccount({
          artistId,
          artistName: artist.name,
        });
        // Compare-and-set: only an artist still without an account gets this one.
        // Of two clicks at once, the second's account stays unused (harmless in
        // test mode) and both continue with the one that was saved.
        await this.prisma.artist.updateMany({
          where: { id: artistId, stripeAccountId: null },
          data: { stripeAccountId: created.accountId },
        });
        const saved = await this.prisma.artist.findUniqueOrThrow({ where: { id: artistId } });
        accountId = saved.stripeAccountId ?? created.accountId;
      }
      const { url } = await this.gateway.createOnboardingLink({
        accountId,
        returnUrl: `${this.config.webUrl}/shows`,
      });
      return { stripeAccountId: accountId, onboardingUrl: url };
    } catch (error) {
      if (error instanceof PaymentConfigError) {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof PaymentRefusedError) {
        throw new ConflictException(error.reason);
      }
      throw error;
    }
  }
}
