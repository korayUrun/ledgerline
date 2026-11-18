import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { formatZodIssues } from "./zod-issues.js";

// Validates a request body with a Zod schema and returns the parsed value.
// Usage: @Body(new ZodBodyPipe(CreateShowBodySchema)) body: CreateShowBody
//
// A bad body is the client's mistake, so it is a 400. (A ZodError that escapes from
// the engine is different: the stored data is the problem, see ApiExceptionFilter.)
export class ZodBodyPipe<Output> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output>) {}

  transform(value: unknown): Output {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Invalid request body",
        issues: formatZodIssues(result.error),
      });
    }
    return result.data;
  }
}
