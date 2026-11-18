// Pure settlement math (F4): no I/O, DB, network, clock or randomness.
export { computeSettlement } from "./compute-settlement.js";
export { applyBps, roundHalfUp, BPS_PER_WHOLE } from "./money.js";

// Stored on every settlement next to its inputSnapshot. Bump it whenever the same
// input could produce a different result (a formula, rounding or line change), so
// an old settlement can be told apart from one the current code would produce.
export const ENGINE_VERSION = "1.0.0";
