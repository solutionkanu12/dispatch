-- Schema per docs/dispatch-architecture.md section 4.
-- agents is created first even though the doc lists orders first, because
-- orders.agent_id has a foreign key reference to agents(id).

CREATE TABLE agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  cap_wallet    TEXT NOT NULL,
  service_tags  TEXT[] NOT NULL,
  price_usdc    NUMERIC NOT NULL,
  store_url     TEXT,
  sla_minutes   INTEGER
);

CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  request_text    TEXT NOT NULL,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  status          TEXT NOT NULL CHECK (status IN ('queued','routed','settled','failed')),
  price_usdc      NUMERIC NOT NULL,
  cap_order_ref   TEXT,
  settlement_proof TEXT,
  result_payload  TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ
);

CREATE INDEX idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);
