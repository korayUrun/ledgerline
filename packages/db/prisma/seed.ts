// Demo data: one venue, three shows with different deal types. All synthetic.
// Run with `pnpm db:seed`. It wipes every table first, so it is safe to run again.
import { ContractTermsSchema, type ContractTerms } from "@ledgerline/schemas";
import { createPrismaClient, DEMO_USER_EMAIL, type Prisma } from "../src/index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
}
const prisma = createPrismaClient(databaseUrl);

type SeedShow = {
  artistName: string;
  showName: string;
  showDate: string; // YYYY-MM-DD
  terms: ContractTerms;
  ticketSales: Omit<Prisma.TicketSaleCreateManyInput, "showId">[];
  expenses: Omit<Prisma.ExpenseCreateManyInput, "showId">[];
};

const shows: SeedShow[] = [
  {
    // Versus deal with a cumulative bonus. Two expenses are still pending, so the
    // worksheet shows the "pending expenses" warning and review is blocked.
    artistName: "The Harbor Lights",
    showName: "The Harbor Lights — Fall Tour",
    showDate: "2026-11-06",
    terms: {
      deal: { type: "versus", guaranteeCents: 500_000, artistShareBps: 8_500, clauseRef: "§4.2" },
      expensePolicy: {
        allowedCategories: ["production", "advertising", "catering", "security"],
        categoryCaps: [{ category: "advertising", capCents: 150_000 }],
        totalCapCents: 600_000,
        clauseRef: "§5",
      },
      bonus: {
        mode: "cumulative",
        tiers: [
          { minTicketsSold: 300, bonusCents: 50_000 },
          { minTicketsSold: 380, bonusCents: 75_000 },
        ],
        clauseRef: "§6",
      },
    },
    ticketSales: [
      {
        tierName: "GA",
        qtySold: 320,
        comps: 25,
        priceCents: 3_500,
        taxCents: 56_000,
        feeCents: 22_400,
      },
      {
        tierName: "VIP",
        qtySold: 70,
        comps: 10,
        priceCents: 8_000,
        taxCents: 28_000,
        feeCents: 11_200,
      },
    ],
    expenses: [
      {
        category: "production",
        description: "Sound and lights crew",
        amountCents: 280_000,
        status: "allowed",
      },
      {
        category: "advertising",
        description: "Social media ads",
        amountCents: 190_000,
        status: "allowed",
      },
      {
        category: "catering",
        description: "Backstage catering",
        amountCents: 85_000,
        status: "pending",
      },
      {
        category: "security",
        description: "Door and floor security",
        amountCents: 120_000,
        status: "allowed",
      },
      {
        category: "office_supplies",
        description: "Printer paper and toner",
        amountCents: 25_000,
        status: "pending",
      },
    ],
  },
  {
    // Guarantee plus a split on a weak night: the overage is zero, so the artist
    // gets the guarantee only.
    artistName: "Mara Quinn",
    showName: "Mara Quinn — Acoustic Night",
    showDate: "2026-11-13",
    terms: {
      deal: {
        type: "guarantee_plus",
        guaranteeCents: 300_000,
        artistShareBps: 8_500,
        promoterProfitBps: 1_500,
        clauseRef: "§3.1",
      },
      expensePolicy: {
        allowedCategories: ["production", "advertising", "security", "staffing"],
        categoryCaps: [],
        totalCapCents: null,
        clauseRef: "§3.4",
      },
      bonus: null,
    },
    ticketSales: [
      {
        tierName: "GA",
        qtySold: 180,
        comps: 12,
        priceCents: 3_000,
        taxCents: 27_000,
        feeCents: 10_800,
      },
    ],
    expenses: [
      {
        category: "production",
        description: "Backline rental",
        amountCents: 150_000,
        status: "allowed",
      },
      {
        category: "staffing",
        description: "Bar and door staff",
        amountCents: 60_000,
        status: "allowed",
      },
      {
        category: "advertising",
        description: "Poster run",
        amountCents: 45_000,
        status: "allowed",
      },
    ],
  },
  {
    // Flat guarantee with a highest-only bonus. Expenses do not change a flat deal.
    artistName: "Static Bloom",
    showName: "Static Bloom — Album Release",
    showDate: "2026-11-14",
    terms: {
      deal: { type: "flat", guaranteeCents: 250_000, clauseRef: "§2" },
      expensePolicy: {
        allowedCategories: [],
        categoryCaps: [],
        totalCapCents: null,
        clauseRef: "§2",
      },
      bonus: {
        mode: "highest_only",
        tiers: [
          { minTicketsSold: 150, bonusCents: 20_000 },
          { minTicketsSold: 200, bonusCents: 40_000 },
        ],
        clauseRef: "§2.3",
      },
    },
    ticketSales: [
      {
        tierName: "GA",
        qtySold: 160,
        comps: 8,
        priceCents: 2_500,
        taxCents: 20_000,
        feeCents: 8_000,
      },
    ],
    expenses: [
      {
        category: "catering",
        description: "Green room catering",
        amountCents: 30_000,
        status: "allowed",
      },
    ],
  },
];

async function main(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Children before parents, so no foreign key is violated.
    await tx.settlementLine.deleteMany();
    await tx.settlement.deleteMany();
    await tx.contractTerms.deleteMany();
    await tx.contract.deleteMany();
    await tx.expense.deleteMany();
    await tx.ticketSale.deleteMany();
    await tx.show.deleteMany();
    await tx.artist.deleteMany();
    await tx.venue.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.user.deleteMany();

    const user = await tx.user.create({ data: { email: DEMO_USER_EMAIL, name: "Demo Manager" } });
    const venue = await tx.venue.create({ data: { name: "The Velvet Room" } });

    for (const seedShow of shows) {
      // Same check the API applies, so the seed cannot store terms the engine rejects.
      const terms = ContractTermsSchema.parse(seedShow.terms);

      const artist = await tx.artist.create({ data: { name: seedShow.artistName } });
      const show = await tx.show.create({
        data: {
          name: seedShow.showName,
          showDate: new Date(`${seedShow.showDate}T00:00:00Z`),
          venueId: venue.id,
          artistId: artist.id,
        },
      });
      await tx.ticketSale.createMany({
        data: seedShow.ticketSales.map((sale) => ({ ...sale, showId: show.id })),
      });
      await tx.expense.createMany({
        data: seedShow.expenses.map((expense) => ({ ...expense, showId: show.id })),
      });
      await tx.contractTerms.create({
        data: {
          showId: show.id,
          version: 1,
          termsJson: terms,
          confirmedById: user.id,
          confirmedAt: new Date(),
        },
      });
    }
  });

  console.log(`Seeded ${shows.length} shows.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
