import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { Prisma } from "@ledgerline/db";
import type { ApiErrorDto } from "@ledgerline/schemas";
import { ZodError } from "zod";
import { formatZodIssues, type Issue } from "./zod-issues.js";

type JsonResponse = { status(code: number): { json(body: unknown): void } };

// Turns every error into the same JSON shape (ApiErrorDto). Registered globally in app.ts.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }
    host.switchToHttp().getResponse<JsonResponse>().status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ApiErrorDto {
    // Request bodies are validated by ZodBodyPipe (400) before they reach a service.
    // So a ZodError that gets this far was thrown while reading STORED data: the
    // engine re-validating its input, or a JSON column that no longer parses. The
    // request was well-formed but the data cannot be settled, hence 422.
    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: "The stored inputs break a settlement rule. Fix the listed fields and recompute.",
        issues: formatZodIssues(exception),
      };
    }

    // P2002 = unique constraint violation. It means a concurrent request created the
    // same thing first (e.g. two saves of terms version 3). The client can retry.
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2002") {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: "Another request changed this data at the same time. Reload and try again.",
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === "string") {
        return { statusCode, message: response };
      }
      const { message, issues } = response as { message?: string | string[]; issues?: Issue[] };
      return {
        statusCode,
        message: Array.isArray(message) ? message.join("; ") : (message ?? exception.message),
        ...(issues ? { issues } : {}),
      };
    }

    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error" };
  }
}
