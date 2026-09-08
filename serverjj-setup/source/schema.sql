CREATE SCHEMA IF NOT EXISTS chutima;
CREATE TABLE IF NOT EXISTS chutima.coordination (
  id integer PRIMARY KEY CHECK(id=1), protocol integer NOT NULL DEFAULT 1,
  initialized boolean NOT NULL DEFAULT false
);
INSERT INTO chutima.coordination(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS chutima.devices (
  id text PRIMARY KEY, label text NOT NULL, slot integer UNIQUE NOT NULL CHECK(slot BETWEEN 1 AND 2),
  key_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  last_sequence bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz
);
CREATE TABLE IF NOT EXISTS chutima.entities (
  collection text NOT NULL, id text NOT NULL, body jsonb,
  owner_device text REFERENCES chutima.devices(id), revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(collection,id)
);
ALTER TABLE chutima.devices ADD COLUMN IF NOT EXISTS reported_pending integer NOT NULL DEFAULT 0 CHECK(reported_pending BETWEEN 0 AND 9999999);
CREATE TABLE IF NOT EXISTS chutima.changefeed (
  sequence bigserial PRIMARY KEY, collection text NOT NULL, id text NOT NULL, body jsonb,
  operation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chutima_changes_entity ON chutima.changefeed(collection,id,sequence);
CREATE TABLE IF NOT EXISTS chutima.operations (
  id text PRIMARY KEY, device_id text NOT NULL REFERENCES chutima.devices(id),
  device_sequence bigint NOT NULL, digest text NOT NULL, payload jsonb NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(device_id,device_sequence)
);
CREATE TABLE IF NOT EXISTS chutima.allocations (
  product_id text NOT NULL, device_id text NOT NULL REFERENCES chutima.devices(id),
  available integer NOT NULL CHECK(available BETWEEN 0 AND 9999999),
  PRIMARY KEY(product_id,device_id)
);
CREATE TABLE IF NOT EXISTS chutima.stock_transfers (
  id text PRIMARY KEY, product_id text NOT NULL,
  from_device text NOT NULL REFERENCES chutima.devices(id), to_device text NOT NULL REFERENCES chutima.devices(id),
  quantity integer NOT NULL CHECK(quantity>0), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_device<>to_device)
);
CREATE TABLE IF NOT EXISTS chutima.web_results (
  id text PRIMARY KEY, digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
