PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS settings_key_unique ON settings (key);

CREATE TABLE IF NOT EXISTS subscription_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url_encrypted TEXT,
  url_masked TEXT,
  raw_content TEXT,
  enabled INTEGER DEFAULT 1 NOT NULL,
  note TEXT,
  last_fetched_at INTEGER,
  last_fetch_status TEXT DEFAULT 'never' NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_cache (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES subscription_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  proxies_count INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscription_cache_source_id_idx ON subscription_cache (source_id);
CREATE INDEX IF NOT EXISTS subscription_cache_fetched_at_idx ON subscription_cache (fetched_at);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY NOT NULL,
  rule_type TEXT NOT NULL,
  value TEXT,
  policy TEXT NOT NULL,
  enabled INTEGER DEFAULT 1 NOT NULL,
  sort_order INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_sort_order_idx ON rules (sort_order);

CREATE TABLE IF NOT EXISTS output_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_client TEXT NOT NULL,
  token TEXT NOT NULL,
  enabled INTEGER DEFAULT 1 NOT NULL,
  options_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS output_profiles_token_unique ON output_profiles (token);

CREATE TABLE IF NOT EXISTS operation_logs (
  id TEXT PRIMARY KEY NOT NULL,
  level TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_logs_created_at_idx ON operation_logs (created_at);
