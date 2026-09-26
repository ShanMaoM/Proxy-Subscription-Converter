import { z } from "zod";

import {
  outputProfileOptionsSchema,
  outputProfileSchema,
  userRuleSchema,
} from "@subscription-converter/shared";

import type { AppConfig } from "../config/env";
import type { DatabaseConnection } from "../db/database";
import { ensureDefaultOutputProfiles } from "../db/defaults";
import { validateRuleSet } from "../rules/service";
import {
  outputProfiles,
  rules,
  settings,
  subscriptionCache,
  subscriptionSources,
} from "../db/schema";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  maskSensitiveUrl,
} from "../security/encryption";

const backupSourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    type: z.enum(["remote_url", "uploaded_yaml", "pasted_yaml"]),
    url: z.string().nullable(),
    rawContent: z.string().nullable(),
    enabled: z.boolean(),
    refreshIntervalMinutes: z
      .number()
      .int()
      .min(15)
      .max(10_080)
      .nullable()
      .default(null),
    trafficUpload: z.number().int().nonnegative().nullable().default(null),
    trafficDownload: z.number().int().nonnegative().nullable().default(null),
    trafficTotal: z.number().int().nonnegative().nullable().default(null),
    expireAt: z.string().datetime().nullable().default(null),
    note: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((source, context) => {
    if (source.type === "remote_url") {
      if (!source.url) {
        context.addIssue({
          code: "custom",
          message: "Remote sources require a URL",
          path: ["url"],
        });
      } else {
        try {
          const url = new URL(source.url);
          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error();
          }
        } catch {
          context.addIssue({
            code: "custom",
            message: "Remote source URL must use HTTP or HTTPS",
            path: ["url"],
          });
        }
      }
      if (source.rawContent) {
        context.addIssue({
          code: "custom",
          message: "Remote sources cannot include raw content",
          path: ["rawContent"],
        });
      }
      return;
    }

    if (source.refreshIntervalMinutes) {
      context.addIssue({
        code: "custom",
        message: "Only remote sources may enable automatic refresh",
        path: ["refreshIntervalMinutes"],
      });
    }
    if (!source.rawContent) {
      context.addIssue({
        code: "custom",
        message: "Local sources require raw content",
        path: ["rawContent"],
      });
    }
    if (source.url) {
      context.addIssue({
        code: "custom",
        message: "Local sources cannot include a URL",
        path: ["url"],
      });
    }
  });

const settingSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const configurationBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  settings: z.array(settingSchema),
  sources: z.array(backupSourceSchema),
  rules: z.array(userRuleSchema),
  outputProfiles: z.array(outputProfileSchema).min(1),
});

export type ConfigurationBackup = z.infer<typeof configurationBackupSchema>;

export class BackupService {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly config: AppConfig,
  ) {}

  export(): ConfigurationBackup {
    const secret = this.getEncryptionSecret();
    return configurationBackupSchema.parse({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.database.db
        .select()
        .from(settings)
        .all()
        .map((setting) => ({
          ...setting,
          createdAt: setting.createdAt.toISOString(),
          updatedAt: setting.updatedAt.toISOString(),
        })),
      sources: this.database.db
        .select()
        .from(subscriptionSources)
        .all()
        .map((source) => ({
          id: source.id,
          name: source.name,
          type: source.type,
          url:
            source.type === "remote_url" && source.urlEncrypted
              ? decryptSensitiveValue(source.urlEncrypted, secret)
              : null,
          rawContent: source.type === "remote_url" ? null : source.rawContent,
          enabled: source.enabled,
          refreshIntervalMinutes: source.refreshIntervalMinutes,
          trafficUpload: source.trafficUpload,
          trafficDownload: source.trafficDownload,
          trafficTotal: source.trafficTotal,
          expireAt: source.expireAt?.toISOString() ?? null,
          note: source.note,
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
        })),
      rules: this.database.db
        .select()
        .from(rules)
        .all()
        .map((rule) => ({
          ...rule,
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        })),
      outputProfiles: this.database.db
        .select()
        .from(outputProfiles)
        .all()
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          targetClient: profile.targetClient,
          token: profile.token,
          enabled: profile.enabled,
          options: outputProfileOptionsSchema.parse(
            JSON.parse(profile.optionsJson),
          ),
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        })),
    });
  }

  restore(input: unknown) {
    const backup = configurationBackupSchema.parse(input);
    validateRuleSet(backup.rules);
    for (const profile of backup.outputProfiles) {
      if (profile.options.customRules)
        validateRuleSet(profile.options.customRules);
    }
    const secret = this.getEncryptionSecret();
    const replaceConfiguration = this.database.sqlite.transaction(() => {
      this.database.db.delete(subscriptionCache).run();
      this.database.db.delete(subscriptionSources).run();
      this.database.db.delete(rules).run();
      this.database.db.delete(settings).run();
      this.database.db.delete(outputProfiles).run();

      if (backup.settings.length > 0) {
        this.database.db
          .insert(settings)
          .values(
            backup.settings.map((setting) => ({
              ...setting,
              createdAt: new Date(setting.createdAt),
              updatedAt: new Date(setting.updatedAt),
            })),
          )
          .run();
      }
      if (backup.sources.length > 0) {
        this.database.db
          .insert(subscriptionSources)
          .values(
            backup.sources.map((source) => ({
              id: source.id,
              name: source.name,
              type: source.type,
              urlEncrypted:
                source.type === "remote_url"
                  ? encryptSensitiveValue(source.url!, secret)
                  : null,
              urlMasked:
                source.type === "remote_url"
                  ? maskSensitiveUrl(source.url!)
                  : null,
              rawContent:
                source.type === "remote_url" ? null : source.rawContent,
              enabled: source.enabled,
              refreshIntervalMinutes: source.refreshIntervalMinutes,
              trafficUpload: source.trafficUpload,
              trafficDownload: source.trafficDownload,
              trafficTotal: source.trafficTotal,
              expireAt: source.expireAt ? new Date(source.expireAt) : null,
              note: source.note,
              lastFetchedAt: null,
              lastFetchStatus: "never" as const,
              lastError: null,
              createdAt: new Date(source.createdAt),
              updatedAt: new Date(source.updatedAt),
            })),
          )
          .run();
      }
      if (backup.rules.length > 0) {
        this.database.db
          .insert(rules)
          .values(
            backup.rules.map((rule) => ({
              ...rule,
              createdAt: new Date(rule.createdAt),
              updatedAt: new Date(rule.updatedAt),
            })),
          )
          .run();
      }
      this.database.db
        .insert(outputProfiles)
        .values(
          backup.outputProfiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            targetClient: profile.targetClient,
            token: profile.token,
            enabled: profile.enabled,
            optionsJson: JSON.stringify(profile.options),
            createdAt: new Date(profile.createdAt),
            updatedAt: new Date(profile.updatedAt),
          })),
        )
        .run();
      ensureDefaultOutputProfiles(this.database);
    });

    replaceConfiguration();
    return {
      settings: backup.settings.length,
      sources: backup.sources.length,
      rules: backup.rules.length,
      outputProfiles: backup.outputProfiles.length,
    };
  }

  private getEncryptionSecret() {
    if (!this.config.SESSION_SECRET) {
      throw new Error("SESSION_SECRET is required for backup operations");
    }
    return this.config.SESSION_SECRET;
  }
}
