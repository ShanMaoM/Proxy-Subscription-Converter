ALTER TABLE subscription_sources
ADD COLUMN traffic_upload INTEGER;

ALTER TABLE subscription_sources
ADD COLUMN traffic_download INTEGER;

ALTER TABLE subscription_sources
ADD COLUMN traffic_total INTEGER;

ALTER TABLE subscription_sources
ADD COLUMN expire_at INTEGER;
