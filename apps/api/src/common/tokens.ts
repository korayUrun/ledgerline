// Injection tokens for values that are not classes. Nest finds a class provider by
// the class itself; a plain value (the config, the Prisma client) needs a name.
export const CONFIG = Symbol("CONFIG");
export const PRISMA = Symbol("PRISMA");
// The LlmClient (an interface, so it has no class Nest could look up). Only the
// worker provides it: the HTTP API never calls Claude.
export const LLM_CLIENT = Symbol("LLM_CLIENT");
