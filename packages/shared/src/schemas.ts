import { z } from "zod";
import {
  clashRuleTypeSchema,
  validateRuleValue,
  normalizeRuleValue,
  rulePolicySchema,
} from "./rule-types";
import { nodeFilterSchema } from "./node-filter";
export { clashRuleTypeSchema } from "./rule-types";

export const subscriptionSourceTypeSchema = z.enum([
  "remote_url",
  "uploaded_yaml",
  "pasted_yaml",
]);

export const fetchStatusSchema = z.enum(["success", "failed", "never"]);
export const refreshIntervalMinutesSchema = z
  .number()
  .int()
  .min(15)
  .max(10_080)
  .nullable()
  .default(null);

export const subscriptionSourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    type: subscriptionSourceTypeSchema,
    urlMasked: z.string().nullable(),
    rawContent: z.string().nullable().optional(),
    enabled: z.boolean(),
    refreshIntervalMinutes: refreshIntervalMinutesSchema,
    nextRefreshAt: z.string().datetime().nullable(),
    trafficUpload: z.number().int().nonnegative().nullable(),
    trafficDownload: z.number().int().nonnegative().nullable(),
    trafficTotal: z.number().int().nonnegative().nullable(),
    expireAt: z.string().datetime().nullable(),
    note: z.string().max(500).nullable(),
    lastFetchedAt: z.string().datetime().nullable(),
    lastFetchStatus: fetchStatusSchema,
    lastError: z.string().nullable(),
    proxiesCount: z.number().int().nonnegative().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((source, context) => {
    if (source.type === "remote_url" && !source.urlMasked) {
      context.addIssue({
        code: "custom",
        message: "Remote URL sources require a masked URL",
        path: ["urlMasked"],
      });
    }

    if (source.type !== "remote_url" && source.urlMasked) {
      context.addIssue({
        code: "custom",
        message: "Only remote URL sources may have a URL",
        path: ["urlMasked"],
      });
    }
    if (source.type !== "remote_url" && source.refreshIntervalMinutes) {
      context.addIssue({
        code: "custom",
        message: "Only remote URL sources may enable automatic refresh",
        path: ["refreshIntervalMinutes"],
      });
    }
  });

export const createSubscriptionSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: subscriptionSourceTypeSchema,
    url: z.string().url().optional(),
    rawContent: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    refreshIntervalMinutes: refreshIntervalMinutesSchema,
    note: z.string().max(500).nullable().optional(),
  })
  .superRefine((source, context) => {
    if (source.type === "remote_url") {
      if (!source.url) {
        context.addIssue({
          code: "custom",
          message: "A remote URL source requires url",
          path: ["url"],
        });
      }
      if (source.rawContent) {
        context.addIssue({
          code: "custom",
          message: "A remote URL source cannot include rawContent",
          path: ["rawContent"],
        });
      }
      return;
    }

    if (source.refreshIntervalMinutes) {
      context.addIssue({
        code: "custom",
        message: "Only remote URL sources may enable automatic refresh",
        path: ["refreshIntervalMinutes"],
      });
    }
    if (!source.rawContent) {
      context.addIssue({
        code: "custom",
        message: "Uploaded and pasted sources require rawContent",
        path: ["rawContent"],
      });
    }
    if (source.url) {
      context.addIssue({
        code: "custom",
        message: "Uploaded and pasted sources cannot include url",
        path: ["url"],
      });
    }
  });

export const updateSubscriptionSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    url: z.string().url().optional(),
    rawContent: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    refreshIntervalMinutes: refreshIntervalMinutesSchema.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((source) => Object.keys(source).length > 0, {
    message: "At least one field must be provided",
  });

export const userRuleSchema = z
  .object({
    id: z.string().min(1),
    ruleType: clashRuleTypeSchema,
    noResolve: z.boolean().optional(),
    value: z.string().trim().nullable(),
    policy: rulePolicySchema,
    enabled: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    note: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .transform((rule) => ({
    ...rule,
    value: rule.value
      ? normalizeRuleValue(rule.ruleType, rule.value)
      : rule.value,
  }))
  .superRefine(validateRuleValue);

export const createUserRuleSchema = z
  .object({
    ruleType: clashRuleTypeSchema,
    noResolve: z.boolean().optional(),
    value: z.string().trim().nullable().default(null),
    policy: rulePolicySchema,
    enabled: z.boolean().default(true),
    note: z.string().max(500).nullable().default(null),
  })
  .transform((rule) => ({
    ...rule,
    value: rule.value
      ? normalizeRuleValue(rule.ruleType, rule.value)
      : rule.value,
  }))
  .superRefine(validateRuleValue);

export const updateUserRuleSchema = z
  .object({
    ruleType: clashRuleTypeSchema.optional(),
    noResolve: z.boolean().optional(),
    value: z.string().trim().nullable().optional(),
    policy: rulePolicySchema.optional(),
    enabled: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((rule) => Object.keys(rule).length > 0, {
    message: "At least one field must be provided",
  });

export const saveUserRuleSchema = z
  .object({
    id: z.string().min(1).optional(),
    ruleType: clashRuleTypeSchema,
    noResolve: z.boolean().optional(),
    value: z.string().trim().nullable().default(null),
    policy: rulePolicySchema,
    enabled: z.boolean().default(true),
    note: z.string().max(500).nullable().default(null),
  })
  .transform((rule) => ({
    ...rule,
    value: rule.value
      ? normalizeRuleValue(rule.ruleType, rule.value)
      : rule.value,
  }))
  .superRefine(validateRuleValue);

export const saveUserRulesSchema = z.object({
  rules: z.array(saveUserRuleSchema),
});

export const proxyGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(["select", "url-test", "fallback", "load-balance"]),
    filter: z.string().trim().max(500).optional(),
    proxies: z.array(z.string().trim().min(1)).default([]),
    url: z.string().url().optional(),
    interval: z.number().int().positive().optional(),
    tolerance: z.number().int().nonnegative().optional(),
  })
  .superRefine((group, context) => {
    if (!group.filter) return;
    try {
      new RegExp(group.filter, "i");
    } catch {
      context.addIssue({
        code: "custom",
        message: "Proxy group filter must be a valid regular expression",
        path: ["filter"],
      });
    }
  })
  .passthrough();

export const ruleProviderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_]+$/, {
    message: "Rule provider names may only contain letters and underscores",
  });

export const ruleProviderSchema = z
  .object({
    type: z.enum(["http", "file", "inline"]).default("http"),
    behavior: z.enum(["domain", "ipcidr", "classical"]),
    url: z.string().url().optional(),
    path: z.string().optional(),
    interval: z.number().int().positive().default(86_400),
    payload: z.array(z.string()).optional(),
  })
  .superRefine((provider, context) => {
    if (provider.type === "http" && !provider.url) {
      context.addIssue({
        code: "custom",
        message: "HTTP rule providers require a URL",
        path: ["url"],
      });
    }
  })
  .passthrough();

export const dnsOptionsSchema = z
  .object({
    enable: z.boolean().default(false),
    ipv6: z.boolean().optional(),
    nameserver: z.array(z.string()).optional(),
    fallback: z.array(z.string()).optional(),
    "enhanced-mode": z.enum(["fake-ip", "redir-host"]).optional(),
    "fake-ip-range": z.string().optional(),
    "fake-ip-filter": z.array(z.string()).optional(),
  })
  .passthrough();

export const outputProfileOptionsSchema = z
  .object({
    nodeFilter: nodeFilterSchema.optional(),
    sourceIds: z.array(z.string().min(1)).max(1000).nullable().optional(),
    customRules: z.array(userRuleSchema).max(10000).nullable().optional(),
    preserveUpstreamRules: z.boolean().default(true),
    subscriptionFilename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^/"\\\r\n]+$/, {
        message: "Subscription filename must not contain path separators",
      })
      .regex(/\.(yaml|yml|conf|txt)$/i, {
        message:
          "Subscription filename must end with .yaml, .yml, .conf or .txt",
      })
      .optional(),
    proxyGroups: z.array(proxyGroupSchema).default([]),
    ruleProviders: z
      .record(ruleProviderNameSchema, ruleProviderSchema)
      .default({}),
    dns: dnsOptionsSchema.nullable().default(null),
    matchPolicy: z.string().trim().min(1).default("PROXY"),
  })
  .superRefine((options, context) => {
    const names = new Set<string>();
    options.proxyGroups.forEach((group, index) => {
      const normalized = group.name.toLocaleLowerCase();
      if (names.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "Proxy group names must be unique",
          path: ["proxyGroups", index, "name"],
        });
      }
      names.add(normalized);
    });
  });

export const createOutputProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetClient: z.enum(["clash", "shadowrocket"]),
  enabled: z.boolean().default(true),
  options: outputProfileOptionsSchema.default(() =>
    outputProfileOptionsSchema.parse({}),
  ),
});

export const updateOutputProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    options: outputProfileOptionsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const outputProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    targetClient: z.enum(["clash", "shadowrocket"]),
    token: z.string().min(24),
    enabled: z.boolean(),
    options: outputProfileOptionsSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((profile, context) => {
    const filename = profile.options.subscriptionFilename;
    if (!filename) return;
    const supported =
      profile.targetClient === "clash" ? /\.(yaml|yml|txt)$/i : /\.conf$/i;
    if (!supported.test(filename))
      context.addIssue({
        code: "custom",
        path: ["options", "subscriptionFilename"],
        message:
          "Subscription filename does not match the profile's target client",
      });
  });

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export function apiSuccessSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

export const apiFailureSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
});

export type SubscriptionSource = z.infer<typeof subscriptionSourceSchema>;
export type CreateSubscriptionSource = z.infer<
  typeof createSubscriptionSourceSchema
>;
export type UpdateSubscriptionSource = z.infer<
  typeof updateSubscriptionSourceSchema
>;
export type UserRule = z.infer<typeof userRuleSchema>;
export type CreateUserRule = z.infer<typeof createUserRuleSchema>;
export type SaveUserRule = z.infer<typeof saveUserRuleSchema>;
export type OutputProfile = z.infer<typeof outputProfileSchema>;
export type OutputProfileOptions = z.infer<typeof outputProfileOptionsSchema>;
export type UpdateOutputProfile = z.infer<typeof updateOutputProfileSchema>;
export type ProxyGroup = z.infer<typeof proxyGroupSchema>;
export type RuleProvider = z.infer<typeof ruleProviderSchema>;
