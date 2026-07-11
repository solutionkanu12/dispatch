/**
 * Real CapService implementation: talks to the running cap-service FastAPI
 * process (cap-service/main.py) over plain HTTP/JSON. This is the concrete
 * implementation capService.ts's own header comment calls for, registered via
 * setCapService() at startup in server.ts.
 *
 * Routes used, confirmed by reading cap-service/main.py directly rather than
 * assumed:
 *
 *   POST {CAP_SERVICE_URL}/orders/place
 *     body: { service_id, requirements?, requester_agent_id?, metadata?,
 *             fund_amount?, fund_token?, wait_seconds?, poll_interval_seconds? }
 *     200 -> { capOrderRef, order_id, negotiation_id, negotiation_status, order }
 *     402 insufficient_balance / 409 negotiation_rejected|negotiation_expired /
 *     503 not_configured / 504 order_not_ready / other passthrough APIError
 *     status, each as { error, message, ... }
 *
 *   GET {CAP_SERVICE_URL}/orders/:order_id
 *     200 -> the full real Order (same field set as capClient.ts's Order,
 *     confirmed field-for-field against the croo Order dataclass)
 *     non-200 -> { error, message, ... }
 *
 * Uses Node's built-in global fetch (available since Node 18, no new
 * dependency needed).
 */

import { CapService, PlaceOrderInput, PlaceOrderResult } from './capService';
import { Order } from './capClient';
import { AgentId } from './classifier';

// Real USDC-on-Base ERC-20 address. Confirmed identical in both
// scripts/verify_cap_funded.py and scripts/verify_chainguard_funded.py.
const USDC_BASE_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// cap-service's own POST /orders/place waits for provider acceptance
// server-side (default 20s, clamped to a 120s ceiling; see
// cap-service/main.py). This client-side timeout is a safety net set past
// that ceiling, so a genuinely hung connection eventually aborts instead of
// leaving /api/dispatch's response open forever. It is not the normal path.
const PLACE_TIMEOUT_MS = 130_000;
const GET_ORDER_TIMEOUT_MS = 15_000;

function capServiceBaseUrl(): string {
  const base = process.env.CAP_SERVICE_URL || 'http://127.0.0.1:8001';
  return base.replace(/\/+$/, '');
}

/**
 * The real CROO service_id each seeded agent negotiates with. This is not the
 * same value as config/agents.json's id ("verimath"/"chainguard") or its
 * store_url UUID; every script that calls negotiate_order against a real
 * provider (scripts/verify_cap.py, scripts/verify_chainguard.py) reads its
 * service_id from CROO_VERIMATH_SERVICE_ID / CROO_CHAINGUARD_SERVICE_ID rather
 * than deriving one, so this does the same instead of guessing that
 * agents.json's store_url identifier is interchangeable with a service_id,
 * which has not been confirmed anywhere in this repo.
 */
function serviceIdForAgent(agentId: AgentId): string {
  const envVar = agentId === 'chainguard' ? 'CROO_CHAINGUARD_SERVICE_ID' : 'CROO_VERIMATH_SERVICE_ID';
  const serviceId = process.env[envVar];
  if (!serviceId) {
    throw new Error(`${envVar} is not set; cannot place a real order for agent "${agentId}".`);
  }
  return serviceId;
}

/**
 * USDC base units for a decimal USDC price, matching the conversion already
 * proven in scripts/verify_cap_funded.py (0.01 USDC -> fund_amount "10000")
 * and scripts/verify_chainguard_funded.py (0.10 USDC -> fund_amount "100000").
 */
function usdcBaseUnits(priceUsdc: number): string {
  return String(Math.round(priceUsdc * 10 ** USDC_DECIMALS));
}

/**
 * Whether each agent's real CROO service accepts fund_amount/fund_token on
 * negotiate_order. Confirmed empirically against the real API, not assumed:
 *
 *   - chainguard: a real placeOrder call against ChainGuard's real service_id
 *     (585dbe8a-af77-4628-a8f3-3f7372ce07da) returned INVALID_PARAMETERS
 *     "fund_amount/fund_token must be empty for non-fund services" when these
 *     fields were sent. Its service is flat priced (non-fund), so they must
 *     be omitted.
 *   - verimath: the same call against VeriMath's real service_id
 *     (dca698b0-9d66-4aff-844d-f77d535dc519) passed parameter validation with
 *     these fields present (it failed later for an unrelated reason,
 *     PROVIDER_NOT_ACCEPTING_ORDERS), so they continue to be sent.
 *
 * There is no SDK call to look this up per service at runtime (croo's
 * AgentClient has no marketplace/service metadata query), so this is fixed
 * per agent rather than derived. If a service's real behavior is ever found
 * to differ from what is recorded here, update this map from new evidence
 * rather than guessing.
 */
const REQUIRES_FUND_TRANSFER: Partial<Record<AgentId, boolean>> = {
  verimath: true,
  chainguard: false,
};

interface CapServiceResponse {
  status: number;
  body: unknown;
}

async function callCapService(
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<CapServiceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${capServiceBaseUrl()}${path}`, { ...init, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Build a readable Error from one of cap-service's JSON error bodies. */
function capServiceError(status: number, body: unknown): Error {
  const record = body as { message?: unknown; error?: unknown } | null;
  const message =
    (record && typeof record.message === 'string' && record.message) ||
    (record && typeof record.error === 'string' && record.error) ||
    `cap-service returned HTTP ${status} with no readable error body.`;
  return new Error(`cap-service error (HTTP ${status}): ${message}`);
}

export class HttpCapService implements CapService {
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const serviceId = serviceIdForAgent(input.agentId);

    // requirements shape: cap-service's NegotiateRequest.requirements is
    // passed straight through to the SDK with no schema cap-service itself
    // imposes. The only real, working requirements payloads in this repo are
    // the fixed test values in scripts/verify_chainguard.py,
    // scripts/verify_polymarket.py, and scripts/verify_test_provider.py, all
    // of which use a plain {"text": "..."} shape; scripts/verify_cap.py's
    // VeriMath call instead used a payload specific to one hardcoded proof
    // ({"op":"verify_prime","n":17}), which does not generalize to arbitrary
    // free text. Dispatch's real requests are arbitrary natural language, so
    // {"text": requestText} is used here uniformly. This has NOT been proven
    // end to end against the live VeriMath/ChainGuard services with arbitrary
    // text (only the fixed example payloads have been proven) -- if either
    // provider expects a different requirements schema, negotiate_order will
    // surface that as a real cap-service error rather than silently
    // succeeding.
    const requirements = JSON.stringify({ text: input.requestText });

    const requestBody: Record<string, string> = { service_id: serviceId, requirements };
    if (REQUIRES_FUND_TRANSFER[input.agentId]) {
      requestBody.fund_amount = usdcBaseUnits(input.priceUsdc);
      requestBody.fund_token = USDC_BASE_TOKEN;
    }

    const { status, body } = await callCapService(
      '/orders/place',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      PLACE_TIMEOUT_MS
    );

    if (status !== 200) {
      throw capServiceError(status, body);
    }

    const record = body as { capOrderRef?: unknown } | null;
    if (!record || typeof record.capOrderRef !== 'string' || !record.capOrderRef) {
      throw new Error('cap-service /orders/place returned 200 with no usable capOrderRef.');
    }

    return { capOrderRef: record.capOrderRef };
  }

  async get_order(orderId: string): Promise<Order> {
    const { status, body } = await callCapService(
      `/orders/${encodeURIComponent(orderId)}`,
      { method: 'GET' },
      GET_ORDER_TIMEOUT_MS
    );

    if (status !== 200) {
      throw capServiceError(status, body);
    }

    // cap-service serializes the croo Order dataclass field for field
    // (snake_case, confirmed against capClient.ts's Order interface), so the
    // parsed body can be passed straight through with no renaming.
    return body as Order;
  }
}
