// Pure settlement math (F4): no I/O, DB, network, clock or randomness.
export { computeSettlement } from "./compute-settlement.js";
export { applyBps, roundHalfUp, BPS_PER_WHOLE } from "./money.js";
