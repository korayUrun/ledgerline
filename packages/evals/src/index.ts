// Eval dataset generator + runner (F11). The generator lives in src/generator,
// the committed dataset in dataset/ (see docs/SYSTEM.md §11).
export {
  EvalCaseSchema,
  listCaseIds,
  loadCase,
  type EvalCase,
  type LoadedCase,
} from "./dataset.js";
