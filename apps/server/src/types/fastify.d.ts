import type { preHandlerHookHandler } from "fastify";

import type { DatabaseConnection } from "../db/database";

declare module "fastify" {
  interface FastifyInstance {
    database: DatabaseConnection;
    requireAuth: preHandlerHookHandler;
  }

  interface FastifyRequest {
    adminUsername?: string;
  }
}
