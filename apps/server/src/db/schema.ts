import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable(
  "settings",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("settings_key_unique").on(table.key)],
);

export const subscriptionSources = sqliteTable("subscription_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["remote_url", "uploaded_yaml", "pasted_yaml"],
  }).notNull(),
  urlEncrypted: text("url_encrypted"),
  urlMasked: text("url_masked"),
  rawContent: text("raw_content"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  refreshIntervalMinutes: integer("refresh_interval_minutes"),
  trafficUpload: integer("traffic_upload"),
  trafficDownload: integer("traffic_download"),
  trafficTotal: integer("traffic_total"),
  expireAt: integer("expire_at", { mode: "timestamp_ms" }),
  note: text("note"),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  lastFetchStatus: text("last_fetch_status", {
    enum: ["success", "failed", "never"],
  })
    .notNull()
    .default("never"),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const subscriptionCache = sqliteTable(
  "subscription_cache",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => subscriptionSources.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    proxiesCount: integer("proxies_count").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("subscription_cache_source_id_idx").on(table.sourceId),
    index("subscription_cache_fetched_at_idx").on(table.fetchedAt),
  ],
);

export const rules = sqliteTable(
  "rules",
  {
    id: text("id").primaryKey(),
    ruleType: text("rule_type").notNull(),
    noResolve: integer("no_resolve", { mode: "boolean" })
      .notNull()
      .default(false),
    value: text("value"),
    policy: text("policy").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("rules_sort_order_idx").on(table.sortOrder)],
);

export const outputProfiles = sqliteTable(
  "output_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    targetClient: text("target_client", {
      enum: ["clash", "shadowrocket"],
    }).notNull(),
    token: text("token").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    optionsJson: text("options_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("output_profiles_token_unique").on(table.token)],
);

export const subscriptionAccessLogs = sqliteTable(
  "subscription_access_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => outputProfiles.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    method: text("method").notNull(),
    format: text("format").notNull(),
    statusCode: integer("status_code").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("subscription_access_profile_id_idx").on(table.profileId, table.id),
    index("subscription_access_created_at_idx").on(table.createdAt),
  ],
);

export const operationLogs = sqliteTable(
  "operation_logs",
  {
    id: text("id").primaryKey(),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull(),
    action: text("action").notNull(),
    message: text("message").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("operation_logs_created_at_idx").on(table.createdAt)],
);

export const subscriptionSourceRelations = relations(
  subscriptionSources,
  ({ many }) => ({
    cacheEntries: many(subscriptionCache),
  }),
);

export const subscriptionCacheRelations = relations(
  subscriptionCache,
  ({ one }) => ({
    source: one(subscriptionSources, {
      fields: [subscriptionCache.sourceId],
      references: [subscriptionSources.id],
    }),
  }),
);

export const databaseSchema = {
  settings,
  subscriptionSources,
  subscriptionCache,
  rules,
  outputProfiles,
  subscriptionAccessLogs,
  operationLogs,
  subscriptionSourceRelations,
  subscriptionCacheRelations,
};
