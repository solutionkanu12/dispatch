/**
 * Order store: the database access layer for the orders table.
 *
 * Every read and write against the orders table goes through here so the route
 * handlers stay free of SQL. The column set mirrors server/config/schema.sql
 * exactly (which in turn follows docs/dispatch-architecture.md section 4):
 *
 *   id, request_text, agent_id, status, price_usdc, cap_order_ref,
 *   settlement_proof, result_payload, failure_reason, created_at, settled_at
 *
 * This module owns its own pg Pool, matching the existing pattern in
 * routes/agents.ts rather than introducing a shared-pool refactor.
 */

import { randomUUID } from 'crypto';
import { Pool } from 'pg';

import { AgentId, classifyRequest } from './classifier';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** The four order states allowed by the schema CHECK constraint. */
export type OrderStatus = 'queued' | 'routed' | 'settled' | 'failed';

/** A full order row as returned to the API, one to one with the table columns. */
export interface OrderRow {
  id: string;
  request_text: string;
  agent_id: string;
  status: OrderStatus;
  price_usdc: number;
  cap_order_ref: string | null;
  settlement_proof: string | null;
  result_payload: string | null;
  failure_reason: string | null;
  created_at: string;
  settled_at: string | null;
}

/**
 * The minimal shape written when an order is first created, before any CAP
 * placement has happened. status is fixed to 'queued' at this stage.
 */
export interface QueuedOrderDraft {
  id: string;
  request_text: string;
  agent_id: AgentId;
  status: 'queued';
  price_usdc: number;
}

/**
 * Pure builder for a brand new queued order. It runs the classifier to pick the
 * provider and stamps status 'queued'. Kept side effect free (no DB, no
 * network) so the classify to queued mapping can be unit tested directly.
 *
 * The agentId is derived from the request text by default. Callers that have
 * already classified may pass it in to avoid classifying twice; the result is
 * identical because the classifier is deterministic.
 *
 * @param requestText the raw user request
 * @param priceUsdc the provider price, looked up from the agents table
 * @param agentId optional pre-computed classification
 * @param id optional id, defaulting to a fresh uuid (id column is TEXT)
 */
export function buildQueuedOrder(
  requestText: string,
  priceUsdc: number,
  agentId: AgentId = classifyRequest(requestText),
  id: string = randomUUID()
): QueuedOrderDraft {
  return {
    id,
    request_text: requestText,
    agent_id: agentId,
    status: 'queued',
    price_usdc: priceUsdc,
  };
}

/**
 * The column list used by every SELECT. price_usdc is cast to float8 so it
 * comes back as a JavaScript number rather than pg's default NUMERIC string,
 * matching how routes/agents.ts returns prices.
 */
const ORDER_COLUMNS = `
  id,
  request_text,
  agent_id,
  status,
  price_usdc::float8 AS price_usdc,
  cap_order_ref,
  settlement_proof,
  result_payload,
  failure_reason,
  created_at,
  settled_at
`;

/** Look up a provider's price from the seeded agents table. Null if unknown. */
export async function getAgentPriceUsdc(agentId: string): Promise<number | null> {
  const result = await pool.query<{ price_usdc: number }>(
    'SELECT price_usdc::float8 AS price_usdc FROM agents WHERE id = $1',
    [agentId]
  );
  return result.rows.length > 0 ? result.rows[0].price_usdc : null;
}

/** Insert a freshly built queued order. */
export async function insertQueuedOrder(draft: QueuedOrderDraft): Promise<void> {
  await pool.query(
    `INSERT INTO orders (id, request_text, agent_id, status, price_usdc)
     VALUES ($1, $2, $3, $4, $5)`,
    [draft.id, draft.request_text, draft.agent_id, draft.status, draft.price_usdc]
  );
}

/**
 * Move an order to 'routed' once CAP placement has produced a real on-chain
 * reference. The cap_order_ref is the handle the settlement poller later uses.
 */
export async function markRouted(id: string, capOrderRef: string): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = 'routed', cap_order_ref = $2 WHERE id = $1`,
    [id, capOrderRef]
  );
}

/** Fields captured when an order settles successfully. */
export interface SettlementDetails {
  settlementProof: string;
  resultPayload: string | null;
}

/**
 * Mark an order settled, recording the settlement proof and (when available)
 * the delivered result payload, and stamping settled_at.
 */
export async function markSettled(
  id: string,
  details: SettlementDetails
): Promise<void> {
  await pool.query(
    `UPDATE orders
     SET status = 'settled',
         settlement_proof = $2,
         result_payload = $3,
         settled_at = now()
     WHERE id = $1`,
    [id, details.settlementProof, details.resultPayload]
  );
}

/**
 * Mark an order failed with a human readable reason. Per the architecture doc,
 * a failed or timed out order must always resolve here with a reason and never
 * be left silently stuck in 'routed'.
 */
export async function markFailed(id: string, failureReason: string): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = 'failed', failure_reason = $2 WHERE id = $1`,
    [id, failureReason]
  );
}

/** List orders for the public ledger, most recent first. */
export async function listOrders(limit = 100): Promise<OrderRow[]> {
  const result = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/** Fetch a single order by id, or null if it does not exist. */
export async function getOrderById(id: string): Promise<OrderRow | null> {
  const result = await pool.query<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`,
    [id]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}
