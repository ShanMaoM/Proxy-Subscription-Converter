import { OutputAvailabilityService } from "./availability-service";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OperationLogService } from "../system/log-service";
import { AccessLogService } from "./access-log-service";
import { OutputProfileService } from "./profile-service";
import { OutputRepository } from "./repository";
import { OutputService } from "./service";

const paramsSchema = z.object({ profileId: z.string().min(1).max(120) });
const querySchema = z.object({
  before: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const notFound = {
  ok: false,
  error: { code: "NOT_FOUND", message: "Output profile not found" },
};

export async function registerProfileRoutes(
  app: FastifyInstance,
  publicBaseUrl: string,
  logs?: OperationLogService,
) {
  const repository = new OutputRepository(app.database);
  const profiles = new OutputProfileService(repository);
  const output = new OutputService(repository);
  const access = new AccessLogService(app.database);
  const availability = new OutputAvailabilityService(repository);
  const auth = { preHandler: app.requireAuth };
  app.get(
    "/api/output/profiles/:profileId/availability",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      const data = availability.check(profileId);
      return data ? { ok: true, data } : reply.status(404).send(notFound);
    },
  );
  app.post("/api/output/profiles", auth, async (request, reply) => {
    const profile = profiles.create(request.body, publicBaseUrl);
    logs?.record({
      action: "output.create-profile",
      message: "Output profile created",
      metadata: { profileId: profile.id },
    });
    return reply.status(201).send({ ok: true, data: profile });
  });
  app.patch("/api/output/profiles/:profileId", auth, async (request, reply) => {
    const { profileId } = paramsSchema.parse(request.params);
    const profile = profiles.update(profileId, request.body, publicBaseUrl);
    if (!profile) return reply.status(404).send(notFound);
    logs?.record({
      action: "output.update-profile",
      message: "Output profile settings updated",
      metadata: { profileId },
    });
    return { ok: true, data: profile };
  });
  app.delete(
    "/api/output/profiles/:profileId",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      if (!profiles.delete(profileId)) return reply.status(404).send(notFound);
      logs?.record({
        action: "output.delete-profile",
        message: "Output profile deleted",
        metadata: { profileId },
      });
      return reply.status(204).send();
    },
  );
  app.get(
    "/api/output/profiles/:profileId/preview",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      const data = output.preview(profileId);
      return data ? { ok: true, data } : reply.status(404).send(notFound);
    },
  );
  app.get(
    "/api/output/profiles/:profileId/rules",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      const data = profiles.rules(profileId);
      return data ? { ok: true, data } : reply.status(404).send(notFound);
    },
  );
  app.put(
    "/api/output/profiles/:profileId/rules",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      const data = profiles.saveRules(profileId, request.body, publicBaseUrl);
      if (!data) return reply.status(404).send(notFound);
      logs?.record({
        action: "output.save-rules",
        message: "Output profile rules saved",
        metadata: { profileId, count: data.length },
      });
      return { ok: true, data };
    },
  );
  app.get(
    "/api/output/profiles/:profileId/access-logs",
    auth,
    async (request, reply) => {
      const { profileId } = paramsSchema.parse(request.params);
      if (!repository.findProfile(profileId))
        return reply.status(404).send(notFound);
      const { before, limit } = querySchema.parse(request.query);
      return { ok: true, data: access.list(profileId, before, limit) };
    },
  );
}
