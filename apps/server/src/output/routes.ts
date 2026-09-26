import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { AccessLogService } from "./access-log-service";
import { registerProfileRoutes } from "./profile-routes";

import type { AppConfig } from "../config/env";
import type { OperationLogService } from "../system/log-service";
import { OutputRepository } from "./repository";
import { OutputService } from "./service";

const profileParamsSchema = z.object({ profileId: z.string().min(1) });
const subscriptionParamsSchema = z.object({
  token: z.string().min(1),
  filename: z.string().min(1).max(200),
});

function previewResponse(
  result: NonNullable<ReturnType<OutputService["generate"]>>,
) {
  return {
    yaml: result.yaml,
    summary: result.summary,
    warnings: result.warnings,
  };
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\/]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"${ascii === filename ? "" : `; filename*=UTF-8''${encoded}`}`;
}

export async function registerOutputRoutes(
  app: FastifyInstance,
  config: AppConfig,
  logs?: OperationLogService,
) {
  const repository = new OutputRepository(app.database);
  const service = new OutputService(repository);
  const accessLogs = new AccessLogService(app.database);
  const publicBaseUrl =
    config.PUBLIC_BASE_URL ?? `http://${config.HOST}:${config.PORT}`;

  app.get(
    "/api/output/profiles",
    { preHandler: app.requireAuth },
    async () => ({
      ok: true,
      data: service.listProfiles(publicBaseUrl),
    }),
  );

  await registerProfileRoutes(app, publicBaseUrl, logs);

  app.get(
    "/api/output/preview/:profileId",
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const { profileId } = profileParamsSchema.parse(request.params);
      const result = service.generate(profileId);
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "Output profile not found" },
        });
      }

      return {
        ok: true,
        data: previewResponse(result),
      };
    },
  );

  app.post(
    "/api/output/regenerate/:profileId",
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const { profileId } = profileParamsSchema.parse(request.params);
      const result = service.generate(profileId);
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "Output profile not found" },
        });
      }
      return { ok: true, data: previewResponse(result) };
    },
  );

  app.get(
    "/api/output/shadowrocket/:profileId/preview",
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const { profileId } = profileParamsSchema.parse(request.params);
      const result = service.generateShadowrocket(profileId);
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "Output profile not found" },
        });
      }
      return {
        ok: true,
        data: {
          content: result.content,
          summary: result.summary,
          warnings: result.warnings,
        },
      };
    },
  );

  app.post(
    "/api/output/:profileId/reset-token",
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const { profileId } = profileParamsSchema.parse(request.params);
      const profile = service.resetToken(profileId);
      if (!profile) {
        return reply.status(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "Output profile not found" },
        });
      }
      logs?.record({
        action: "output.reset-token",
        message: "Output profile token reset",
        metadata: { profileId },
      });
      return {
        ok: true,
        data: service
          .listProfiles(publicBaseUrl)
          .find((item) => item.id === profileId),
      };
    },
  );

  app.get(
    "/sub/:token/:filename",
    {
      onResponse: async (request, reply) => {
        const params = request.params as
          | { token?: string; filename?: string }
          | undefined;
        if (!params?.token) return;
        const profile = repository.findProfileByToken(params.token);
        if (!profile) return;
        const extension = params.filename
          ?.toLowerCase()
          .match(/\.([^.]+)$/)?.[1];
        const format = ["yaml", "yml", "conf", "txt"].includes(extension ?? "")
          ? extension!
          : "unknown";
        try {
          accessLogs.record(
            profile.id,
            request.ip,
            request.method,
            format,
            reply.statusCode,
          );
        } catch {
          request.log.error(
            { profileId: profile.id },
            "Subscription access record could not be saved",
          );
        }
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const { token, filename } = subscriptionParamsSchema.parse(
        request.params,
      );
      const safeFilename = filename.replace(/["\\\r\n]/g, "_");
      const extension = safeFilename.toLowerCase().match(/\.([^.]+)$/)?.[1];

      if (extension === "yaml" || extension === "yml") {
        const result = service.generateByToken(token, "clash");
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "Subscription not found" },
          });
        }

        return reply
          .type("text/yaml; charset=utf-8")
          .header("content-disposition", contentDisposition(safeFilename))
          .send(result.yaml);
      }

      if (extension === "conf") {
        const result = service.generateShadowrocketByToken(token);
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "Subscription not found" },
          });
        }

        return reply
          .type("text/plain; charset=utf-8")
          .header("content-disposition", contentDisposition(safeFilename))
          .send(result.content);
      }

      if (extension === "txt") {
        const result = service.generateBase64ByToken(token);
        if (!result) {
          return reply.status(404).send({
            ok: false,
            error: { code: "NOT_FOUND", message: "Subscription not found" },
          });
        }

        return reply
          .type("text/plain; charset=utf-8")
          .header("content-disposition", contentDisposition(safeFilename))
          .send(result.content);
      }

      return reply.status(404).send({
        ok: false,
        error: {
          code: "UNSUPPORTED_SUBSCRIPTION_FILENAME",
          message:
            "Subscription filename must end with .yaml, .yml, .conf or .txt",
        },
      });
    },
  );
}
