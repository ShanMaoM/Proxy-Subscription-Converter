import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config/env";
import { sessionCookieName, verifySessionToken } from "./session";

export function createRequireAuth(config: AppConfig) {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const token = request.cookies[sessionCookieName];

    if (!token) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      });
    }

    try {
      request.adminUsername = (
        await verifySessionToken(config, token)
      ).username;
    } catch {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Session is invalid or expired",
        },
      });
    }
  };
}
