import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATASET_DIR } from "../dataset.js";
import { DATASET_SIZE, generateCase } from "../generator/generate-case.js";

// pnpm --filter @ledgerline/evals generate
// Rewrites dataset/ from scratch. The output is deterministic, so running it on an
// unchanged generator produces no git diff.
await rm(DATASET_DIR, { recursive: true, force: true });
for (let index = 0; index < DATASET_SIZE; index++) {
  const generated = await generateCase(index);
  const caseDir = path.join(DATASET_DIR, generated.evalCase.id);
  await mkdir(caseDir, { recursive: true });
  await writeFile(
    path.join(caseDir, "case.json"),
    `${JSON.stringify(generated.evalCase, null, 2)}\n`,
  );
  await writeFile(path.join(caseDir, "contract.pdf"), generated.pdf);
  await writeFile(path.join(caseDir, "contract.txt"), generated.text);
  const sha = createHash("sha256").update(generated.pdf).digest("hex").slice(0, 12);
  console.log(
    `${generated.evalCase.id}  ${generated.evalCase.dealType.padEnd(14)} payout=${generated.evalCase.expectedPayoutCents}  pdf=${sha}  tags=${generated.evalCase.tags.join(",")}`,
  );
}
