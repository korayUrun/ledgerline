import type { SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

// A request body schema for @ApiBody, which (unlike the response decorators) has no
// `standardSchema` option. Same converter and target Swagger uses for responses.
// The cast: Zod's JSON Schema type allows `true`/`false` as a schema, OpenAPI 3.0's
// SchemaObject does not. Plain object schemas like ours never produce one.
export function requestBodySchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" }) as SchemaObject;
}
