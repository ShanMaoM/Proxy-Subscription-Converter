import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyServerOptions } from "fastify";
import { resolve } from "node:path";

import { registerAuthRoutes } from "./auth/routes";
import type { AppConfig } from "./config/env";
import { loadConfig } from "./config/env";
import { initializeDatabase, type DatabaseConnection } from "./db/database";
import { ensureDefaultOutputProfiles } from "./db/defaults";
import { registerErrorHandler } from "./http/errors";
import { registerOutputRoutes } from "./output/routes";
import { registerHealthRoutes } from "./routes/health";
import type { RemoteFetcher } from "./remote/fetch-subscription";
import { registerRuleRoutes } from "./rules/routes";
import { registerSourceRoutes } from "./sources/routes";
import { SourceRefreshScheduler } from "./sources/scheduler";
import { OperationLogService } from "./system/log-service";
import { registerSystemRoutes } from "./system/routes";

export type CreateAppOptions = {
  config?: AppConfig;
  database?: DatabaseConnection;
  enableDatabase?: boolean;
  enableAuth?: boolean;
  logger?: FastifyServerOptions["logger"];
  remoteFetcher?: RemoteFetcher;
  enableSourceScheduler?: boolean;
};

export const maxRequestBodyBytes = 120 * 1024 * 1024;

export async function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const configuredLogger =
    options.logger ??
    (config.NODE_ENV === "test"
      ? false
      : {
          level: config.NODE_ENV === "production" ? "info" : "debug",
        });

  const logger =
    configuredLogger === false
      ? false
      : {
          ...(typeof configuredLogger === "object" ? configuredLogger : {}),
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
              "*.password",
              "*.token",
              "*.url",
            ],
            censor: "[REDACTED]",
          },
        };
  const app = Fastify({
    logger,
    bodyLimit: maxRequestBodyBytes,
    trustProxy: config.TRUST_PROXY_HOPS || false,
  });
  let sourceScheduler: SourceRefreshScheduler | undefined;
  const database =
    options.enableDatabase === false
      ? undefined
      : (options.database ?? initializeDatabase(config.DATABASE_URL));
  if (database) {
    ensureDefaultOutputProfiles(database);
  }

  registerErrorHandler(app);
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(cookie);
  await registerHealthRoutes(app);

  if (options.enableAuth !== false) {
    await registerAuthRoutes(app, config);
    if (!database) {
      throw new Error("Database is required for management routes");
    }
    app.decorate("database", database);
    const operationLogs = new OperationLogService(database);
    const sourceService = await registerSourceRoutes(
      app,
      config,
      options.remoteFetcher,
      operationLogs,
    );
    if (options.enableSourceScheduler ?? config.NODE_ENV !== "test") {
      sourceScheduler = new SourceRefreshScheduler(
        sourceService,
        operationLogs,
        app.log,
      );
      app.addHook("onReady", async () => sourceScheduler?.start());
    }
    await registerRuleRoutes(app, operationLogs);
    await registerOutputRoutes(app, config, operationLogs);
    await registerSystemRoutes(app, config, operationLogs);
  }

  if (config.STATIC_ROOT) {
    const staticRoot = resolve(config.STATIC_ROOT);
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
      maxAge: "30d",
      immutable: true,
      setHeaders(response, path) {
        if (path.endsWith("index.html")) {
          response.setHeader("cache-control", "no-cache");
        }
      },
    });
  }
  app.setNotFoundHandler(async (request, reply) => {
    if (
      config.STATIC_ROOT &&
      request.method === "GET" &&
      request.headers.accept?.includes("text/html") &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/sub/")
    ) {
      return reply.sendFile("index.html", {
        maxAge: 0,
        immutable: false,
      });
    }
    return reply.status(404).send({
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  if (database) {
    app.addHook("onClose", async () => {
      await sourceScheduler?.stop();
      database.close();
    });
  }

  return app;
}
