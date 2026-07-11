/**
 * CAP service port: the seam between the HTTP layer and the real CAP network.
 *
 * docs/dispatch-architecture.md section 3 and docs/dispatch-tasks.md Tasks 6
 * and 7 assume a TypeScript `capClient.placeOrder(...)` that calls the CAP SDK
 * directly. That was never built, because the only proven CAP SDK in this repo
 * is Python (the croo package, exercised by scripts/*.py) -- there is no
 * TypeScript CAP SDK to wrap directly. Instead this module defines the narrow
 * port the routes depend on, and the concrete implementation
 * (HttpCapService, in server/services/httpCapService.ts) satisfies it by
 * calling the running cap-service FastAPI process (cap-service/main.py) over
 * HTTP, which in turn is the one that holds the real croo SDK client.
 * server/server.ts registers that implementation via setCapService() at
 * startup. If cap-service is unreachable or misconfigured (wrong
 * CAP_SERVICE_URL, missing CROO_*_SERVICE_ID), placement fails cleanly with a
 * clear reason rather than pretending to succeed -- see httpCapService.ts.
 *
 * The port deliberately reuses OrderPollClient from capClient.ts (its get_order
 * method name was verified against the real croo AgentClient) so the same
 * injected object drives both placement and the existing pollOrderUntilSettled.
 */

import { OrderPollClient } from './capClient';
import { AgentId } from './classifier';

/**
 * Input to a placement: which provider to hire, the request to fulfil, and
 * the provider's USDC price (from the seeded agents table, looked up by the
 * caller) so the order can be funded for that exact amount.
 */
export interface PlaceOrderInput {
  agentId: AgentId;
  requestText: string;
  priceUsdc: number;
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
