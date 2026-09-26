import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sanitizeLogMessage } from "../system/log-sanitizer";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.flatten(),
        },
      });
    }

    const normalizedError =
      error instanceof Error ? error : new Error("Unknown request error");
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
        ? error.statusCode
        : 500;

    request.log.error(
      {
        err: {
          name: normalizedError.name,
          message: sanitizeLogMessage(normalizedError.message),
        },
      },
      "Request failed",
    );

    return reply.status(statusCode).send({
      ok: false,
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message:
          statusCode >= 500
            ? "An unexpected error occurred"
            : sanitizeLogMessage(normalizedError.message),
      },
    });
  });
}
