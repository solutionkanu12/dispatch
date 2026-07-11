/**
 * Unit test for the classify to queued order flow.
 *
 * This exercises the pure part of the dispatch pipeline: given a request text
 * and a price, buildQueuedOrder classifies to a provider and produces the
 * initial queued record. It touches no database and no CAP network, matching
 * the same node:test / assert pattern used by capClient.order.test.ts.
 *
 * Run with:
 *   node --require ts-node/register --test server/routes/dispatch.flow.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildQueuedOrder } from '../services/orderStore';

test('a contract audit request queues an order routed to chainguard', () => {
  const draft = buildQueuedOrder('please audit this token contract', 0.1);
  assert.equal(draft.agent_id, 'chainguard');
  assert.equal(draft.status, 'queued');
  assert.equal(draft.price_usdc, 0.1);
  assert.equal(draft.request_text, 'please audit this token contract');
  // A uuid is generated for the id by default.
  assert.equal(typeof draft.id, 'string');
  assert.ok(draft.id.length > 0);
});

test('a plain math request queues an order routed to verimath', () => {
  const draft = buildQueuedOrder('verify that 2 plus 2 equals 4', 0.01);
  assert.equal(draft.agent_id, 'verimath');
  assert.equal(draft.status, 'queued');
  assert.equal(draft.price_usdc, 0.01);
});

test('an explicit agent id and id are used verbatim when provided', () => {
  const draft = buildQueuedOrder('anything', 0.05, 'verimath', 'fixed-id-123');
  assert.equal(draft.agent_id, 'verimath');
  assert.equal(draft.id, 'fixed-id-123');
});

test('each generated order gets a distinct id', () => {
  const a = buildQueuedOrder('scan this contract', 0.1);
  const b = buildQueuedOrder('scan this contract', 0.1);
  assert.notEqual(a.id, b.id);
});
