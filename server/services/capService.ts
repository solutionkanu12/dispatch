/**
 * CAP service port: the seam between the HTTP layer and the real CAP network.
 *
 * IMPORTANT DISCREPANCY (flagged, not silently papered over):
 * docs/dispatch-architecture.md section 3 and docs/dispatch-tasks.md Tasks 6
 * and 7 assume a TypeScript `capClient.placeOrder(...)` and
 * `capClient.getOrderStatus(...)` that call the CAP SDK directly. Those network
 * wrappers were never built in TypeScript. What exists in capClient.ts is only
 * pure decision logic (assessOrder, pollOrderUntilSettled, assessNegotiation,
 * toFailureReason) with no network calls. The actual CAP SDK in this repo is
 * Python (the croo package, exercised by scripts/*.py); there is no Node to
 * Python bridge yet.
 *
 * So placing a real on chain order from Node is not something the repo can do
 * today, and inventing that behavior here would mean fabricating CAP SDK calls
 * and field names, which we must not do. Instead this module defines the narrow
 * port the routes depend on and leaves the concrete implementation as an
 * injected dependency. The real CAP integration (the missing Task 6 and Task 7
 * network layer, or a Node to Python bridge) must call setCapService() at
 * startup to make dispatch fully live. Until then placement fails cleanly with
 * a clear reason rather than pretending to succeed.
 *
 * The port deliberately reuses OrderPollClient from capClient.ts (its get_order
 * method name was verified against the real croo AgentClient) so the same
 * injected object drives both placement and the existing pollOrderUntilSettled.
 */

import { OrderPollClient } from './capClient';
import { AgentId } from './classifier';

/** Input to a placement: which provider to hire and the request to fulfil. */
export interface PlaceOrderInput {
  agentId: AgentId;
  requestText: string;
}

/**
 * Result of a placement. capOrderRef is the on chain order reference stored in
 * orders.cap_order_ref and later passed to get_order by the settlement poller.
 */
export interface PlaceOrderResult {
  capOrderRef: string;
}

/**
 * Everything the routes need from CAP: placing an order, plus the get_order
 * method (inherited from OrderPollClient) that pollOrderUntilSettled calls.
 */
export interface CapService extends OrderPollClient {
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
}

let current: CapService | null = null;

/**
 * Register the concrete CAP service. The real CAP integration calls this once
 * at startup. Tests inject a fake here to exercise the full route flow without
 * a network.
 */
export function setCapService(service: CapService | null): void {
  current = service;
}

/**
 * Get the configured CAP service, or throw a clear, human readable error if
 * none has been registered. The throw is intentional: the dispatch route
 * catches it and resolves the order to 'failed' with a readable reason via the
 * existing toFailureReason path, so a missing integration surfaces in the
 * ledger instead of hanging or silently succeeding.
 */
export function getCapService(): CapService {
  if (!current) {
    throw new Error(
      'CAP service is not configured: the real CAP placement and polling ' +
        'integration has not been registered via setCapService(). See ' +
        'server/services/capService.ts for details.'
    );
  }
  return current;
}
