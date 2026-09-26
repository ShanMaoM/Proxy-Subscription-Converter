import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { OperationLogService } from "../system/log-service";
import { RuleRepository } from "./repository";
import { RuleService } from "./service";

const idParamsSchema = z.object({ id: z.string().min(1) });
const reorderSchema = z.object({ ids: z.array(z.string().min(1)) });
const validateSchema = z.object({ rules: z.array(z.unknown()) });

export async function registerRuleRoutes(
  app: FastifyInstance,
  logs?: OperationLogService,
) {
  const service = new RuleService(new RuleRepository(app.database));
  const protectedRoute = { preHandler: app.requireAuth };

  app.get("/api/rules", protectedRoute, async () => ({
    ok: true,
    data: service.list(),
  }));

  app.post("/api/rules", protectedRoute, async (request, reply) => {
    const rule = service.create(request.body);
    logs?.record({
      action: "rule.create",
      message: `Rule created: ${rule.ruleType}`,
      metadata: { ruleId: rule.id, ruleType: rule.ruleType },
    });
    return reply.status(201).send({ ok: true, data: rule });
  });

  app.put("/api/rules", protectedRoute, async (request) => {
    const data = service.replaceAll(request.body);
    logs?.record({
      action: "rule.save_all",
      message: "Rules saved",
      metadata: { count: data.length },
    });
    return { ok: true, data };
  });

  app.patch("/api/rules/:id", protectedRoute, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const rule = service.update(id, request.body);
    if (!rule) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Rule not found" },
      });
    }
    logs?.record({
      action: "rule.update",
      message: `Rule updated: ${rule.ruleType}`,
      metadata: { ruleId: rule.id, ruleType: rule.ruleType },
    });
    return { ok: true, data: rule };
  });

  app.delete("/api/rules/:id", protectedRoute, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    if (!service.delete(id)) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "Rule not found" },
      });
    }
    logs?.record({
      action: "rule.delete",
      message: "Rule deleted",
      metadata: { ruleId: id },
    });
    return reply.status(204).send();
  });

  app.post("/api/rules/reorder", protectedRoute, async (request) => {
    const { ids } = reorderSchema.parse(request.body);
    const data = service.reorder(ids);
    logs?.record({
      action: "rule.reorder",
      message: "Rules reordered",
      metadata: { ruleIds: ids },
    });
    return { ok: true, data };
  });

  app.post("/api/rules/validate", protectedRoute, async (request) => {
    const { rules } = validateSchema.parse(request.body);
    return { ok: true, data: service.validate(rules) };
  });
}
