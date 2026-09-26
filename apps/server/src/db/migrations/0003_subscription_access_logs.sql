CREATE TABLE subscription_access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES output_profiles(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  method TEXT NOT NULL,
  format TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX subscription_access_profile_id_idx ON subscription_access_logs(profile_id, id);
CREATE INDEX subscription_access_created_at_idx ON subscription_access_logs(created_at);
