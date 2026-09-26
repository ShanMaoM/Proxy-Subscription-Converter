import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config/env";
import { BackupService } from "./backup-service";
import { OperationLogService } from "./log-service";

const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function registerSystemRoutes(
  app: FastifyInstance,
  config: AppConfig,
  logs: OperationLogService,
) {
  const backup = new BackupService(app.database, config);
  const protectedRoute = { preHandler: app.requireAuth };

  app.get("/api/system/logs", protectedRoute, async (request) => {
    const { limit } = logQuerySchema.parse(request.query);
    return { ok: true, data: logs.list(limit) };
  });

  app.get("/api/system/backup", protectedRoute, async () => {
    const data = backup.export();
    logs.record({
      action: "backup.export",
      message: "Configuration backup exported",
      metadata: {
        sources: data.sources.length,
        rules: data.rules.length,
        outputProfiles: data.outputProfiles.length,
      },
    });
    return { ok: true, data };
  });

  app.post("/api/system/restore", protectedRoute, async (request) => {
    const result = backup.restore(request.body);
    logs.record({
      action: "backup.restore",
      message: "Configuration backup restored",
      metadata: result,
    });
    return { ok: true, data: result };
  });
}
