import {
  FakeLlmClient,
  fakeTextMessage,
  fakeToolUseMessage,
  type LlmClient,
} from "@ledgerline/api";
import type { EvalCase } from "../dataset.js";

// A fake Claude that flags exactly the planted violations: call 1 asks for one
// flag_expense per violation (all in one reply, as a real model may), the next
// call answers. A case with nothing planted gets the answer at once. It measures
// nothing about the model; it tests the eval pipeline (the real tools take the
// ids, the flags are recorded and scored). It must score 100%.
export function agentOracleClient(evalCase: EvalCase): LlmClient {
  const usage = { model: "oracle", inputTokens: 0, outputTokens: 0 };
  const flagCalls = evalCase.plantedViolations.map((violation, index) => ({
    id: `toolu_${index + 1}`,
    name: "flag_expense",
    input: {
      expenseId: violation.expenseId,
      kind: violation.kind,
      reason: "(oracle: planted violation)",
    },
  }));
  return new FakeLlmClient((_params, call) =>
    call === 1 && flagCalls.length > 0
      ? fakeToolUseMessage(flagCalls, usage)
      : fakeTextMessage("(oracle) Done.", usage),
  );
}
