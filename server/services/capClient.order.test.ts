/**
 * Unit tests for assessOrder.
 *
 * These tests use plain fake Order objects built in memory. There is no
 * network access and no croo SDK import: assessOrder is a pure function, so we
 * only need the Order type (a compile time only import) and a reference time.
 *
 * Run with:
 *   node --require ts-node/register --test server/services/capClient.order.test.ts
 *
 * They rely only on Node's built in test runner and assert module, so no test
 * framework needs to be installed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessOrder, type Order, type OrderVerdict } from './capClient';

/**
 * Build a fake Order with every field defaulted to its empty value, matching
 * the real dataclass defaults, and override only the fields a test cares
 * about. This keeps each test focused on the signal it is exercising.
 */
function makeOrder(overrides: Partial<Order> = {}): Order {
  const base: Order = {
    order_id: '',
    negotiation_id: '',
    chain_order_id: '',
    service_id: '',
    requester_agent_id: '',
    provider_agent_id: '',
    buyer_user_id: '',
    requester_wallet_address: '',
    provider_wallet_address: '',
    price: '',
    payment_token: '',
    delivery_window: 0,
    status: '',
    reject_reason: '',
    create_tx_hash: '',
    pay_tx_hash: '',
    deliver_tx_hash: '',
    reject_tx_hash: '',
    clear_tx_hash: '',
    sla_deadline: '',
    pay_deadline: '',
    created_time: '',
    updated_time: '',
    created_at: '',
    paid_at: '',
    delivered_at: '',
    rejected_at: '',
    expired_at: '',
    fee_amount: '',
    fund_amount: '',
    fund_token: '',
    provider_fund_address: '',
  };
  return { ...base, ...overrides };
}

// A fixed reference time so deadline comparisons are deterministic.
const NOW = new Date('2026-07-11T12:00:00.000Z');
const PAST = '2026-07-11T11:00:00.000Z';
const FUTURE = '2026-07-11T13:00:00.000Z';

test('settled: clear_tx_hash present returns settled with the hash', () => {
  const order = makeOrder({ clear_tx_hash: '0xclear' });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'settled', clearTxHash: '0xclear' });
});

test('settled wins even when the sla deadline has already passed', () => {
  // A cleared order cannot un settle, so a passed deadline must not override it.
  const order = makeOrder({
    clear_tx_hash: '0xclear',
    pay_tx_hash: '0xpay',
    deliver_tx_hash: '0xdeliver',
    sla_deadline: PAST,
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'settled', clearTxHash: '0xclear' });
});

test('rejected via reject_tx_hash uses reject_reason when present', () => {
  const order = makeOrder({
    reject_tx_hash: '0xreject',
    reject_reason: 'provider offline',
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'rejected', reason: 'provider offline' });
});

test('rejected via rejected_at only (no reject hash) still rejects', () => {
  const order = makeOrder({ rejected_at: '2026-07-11T11:30:00.000Z' });
  const verdict = assessOrder(order, NOW);
  assert.equal(verdict.state, 'rejected');
  // No reject_reason was set, so a readable fallback is used.
  assert.deepEqual(verdict, {
    state: 'rejected',
    reason: 'order rejected by provider',
  });
});

test('in progress at created stage: nothing paid yet', () => {
  const order = makeOrder({ create_tx_hash: '0xcreate' });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'created' });
});

test('in progress at paid stage: paid but not delivered', () => {
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    pay_tx_hash: '0xpay',
    sla_deadline: FUTURE,
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'paid' });
});

test('in progress at delivered stage: delivered but not cleared', () => {
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    pay_tx_hash: '0xpay',
    deliver_tx_hash: '0xdeliver',
    sla_deadline: FUTURE,
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'delivered' });
});

test('timed out: created stage past its pay_deadline', () => {
  const order = makeOrder({ create_tx_hash: '0xcreate', pay_deadline: PAST });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'timed_out' });
});

test('timed out: paid stage past its sla_deadline', () => {
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    pay_tx_hash: '0xpay',
    sla_deadline: PAST,
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'timed_out' });
});

test('timed out: server recorded expired_at is treated as a timeout', () => {
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    expired_at: '2026-07-11T11:45:00.000Z',
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'timed_out' });
});

test('unparseable deadline does not crash and stays in progress', () => {
  // A garbage deadline must not be read as an expiry: we cannot prove timeout.
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    pay_deadline: 'not-a-real-date',
  });
  let verdict: OrderVerdict | undefined;
  assert.doesNotThrow(() => {
    verdict = assessOrder(order, NOW);
  });
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'created' });
});

test('created stage with no deadline set stays in progress', () => {
  // Empty deadline strings are the default; absence must not mean timeout.
  const order = makeOrder({ create_tx_hash: '0xcreate' });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'created' });
});

test('the created stage ignores an unrelated sla_deadline in the past', () => {
  // Before payment the sla clock is not the relevant one, only pay_deadline is.
  const order = makeOrder({
    create_tx_hash: '0xcreate',
    sla_deadline: PAST,
    pay_deadline: FUTURE,
  });
  const verdict = assessOrder(order, NOW);
  assert.deepEqual(verdict, { state: 'in_progress', stage: 'created' });
});
