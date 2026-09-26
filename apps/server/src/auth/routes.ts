import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config/env";
import { createRequireAuth } from "./guard";
import {
  createSessionToken,
  sessionCookieName,
  verifyPassword,
} from "./session";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function registerAuthRoutes(
  app: FastifyInstance,
  config: AppConfig,
) {
  if (!config.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is required to enable authentication");
  }
  if (!config.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required to enable authentication");
  }

  const requireAuth = createRequireAuth(config);

  app.post("/api/auth/login", async (request, reply) => {
    const credentials = loginSchema.parse(request.body);
    const validUsername = credentials.username === config.ADMIN_USERNAME;
    const validPassword = verifyPassword(
      credentials.password,
      config.ADMIN_PASSWORD!,
    );

    if (!validUsername || !validPassword) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid username or password",
        },
      });
    }

    const token = await createSessionToken(config, config.ADMIN_USERNAME);
    reply.setCookie(sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return {
      ok: true,
      data: {
        username: config.ADMIN_USERNAME,
      },
    };
  });

  app.post(
    "/api/auth/logout",
    { preHandler: requireAuth },
    async (_request, reply) => {
      reply.clearCookie(sessionCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.NODE_ENV === "production",
        path: "/",
      });

      return {
        ok: true,
        data: {
          loggedOut: true,
        },
      };
    },
  );

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => ({
    ok: true,
    data: {
      username: request.adminUsername,
    },
  }));

  app.decorate("requireAuth", requireAuth);
}
