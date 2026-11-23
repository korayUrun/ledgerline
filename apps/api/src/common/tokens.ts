// Injection tokens for values that are not classes. Nest finds a class provider by
// the class itself; a plain value (the config, the Prisma client) needs a name.
export const CONFIG = Symbol("CONFIG");
export const PRISMA = Symbol("PRISMA");
// The LlmClient (an interface, so it has no class Nest could look up). The worker
// uses it to read contracts, the API to run the audit agent.
export const LLM_CLIENT = Symbol("LLM_CLIENT");
// The PaymentGateway (Stripe in the app, a fake in tests), or null when Stripe is
// not configured.
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
// The pino logger, for code that logs fields rather than a message (request lines).
export const LOGGER = Symbol("LOGGER");
