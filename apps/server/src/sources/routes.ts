import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config/env";
import type { RemoteFetcher } from "../remote/fetch-subscription";
import type { OperationLogService } from "../system/log-service";
import { SourceRepository } from "./repository";
import { SourceService } from "./service";

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function registerSourceRoutes(
  app: FastifyInstance,
  config: AppConfig,
  remoteFetcher?: RemoteFetcher,
  logs?: OperationLogService,
) {
  const service = new SourceService(
    new SourceRepository(app.database),
    config,
    remoteFetcher,
  );
  const protectedRoute = { preHandler: app.requireAuth };

  app.get("/api/sources", protectedRoute, async () => ({
    ok: true,
    data: service.list(),
  }));

  app.post("/api/sources", protectedRoute, async (request, reply) => {
    const source = service.create(request.body);
    logs?.record({
      action: "source.create",
      message: `Source created: ${source.name}`,
      metadata: { sourceId: source.id, sourceType: source.type },
    });
    return reply.status(201).send({ ok: true, data: source });
  });

  app.get("/api/sources/:id", protectedRoute, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const source = service.get(id);
    if (!source) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Source not found" },
      });
    }
    return { ok: true, data: source };
  });

  app.patch("/api/sources/:id", protectedRoute, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const source = service.update(id, request.body);
    if (!source) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Source not found" },
      });
    }
    logs?.record({
      action: "source.update",
      message: `Source updated: ${source.name}`,
      metadata: {
        sourceId: source.id,
        sourceType: source.type,
        refreshIntervalMinutes: source.refreshIntervalMinutes,
      },
    });
    return { ok: true, data: source };
  });

  app.delete("/api/sources/:id", protectedRoute, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const source = service.get(id);
    if (!service.delete(id)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Source not found" },
      });
    }
    logs?.record({
      action: "source.delete",
      message: `Source deleted: ${source?.name ?? id}`,
      metadata: { sourceId: id, sourceType: source?.type },
    });
    return reply.status(204).send();
  });

  app.post(
    "/api/sources/:id/refresh",
    protectedRoute,
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      try {
        const result = await service.refresh(id);
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "Source not found" },
          });
        }
        logs?.record({
          action: "source.refresh",
          message: `Source refreshed: ${result.source.name}`,
          metadata: {
            sourceId: id,
            proxiesCount: result.source.proxiesCount,
          },
        });
        return { ok: true, data: result };
      } catch (error) {
        logs?.record({
          level: "error",
          action: "source.refresh",
          message:
            error instanceof Error ? error.message : "Source refresh failed",
          metadata: { sourceId: id },
        });
        throw error;
      }
    },
  );

  return service;
}
