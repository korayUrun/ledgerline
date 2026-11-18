// Injection tokens for values that are not classes. Nest finds a class provider by
// the class itself; a plain value (the config, the Prisma client) needs a name.
export const CONFIG = Symbol("CONFIG");
export const PRISMA = Symbol("PRISMA");
