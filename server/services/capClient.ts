/**
 * CAP client failure and timeout logic.
 *
 * This module contains only the pure decision logic for Task 8: given a
 * Negotiation (or an error thrown at negotiate time), decide whether the
 * attempt should be considered failed and produce a human readable
 * failure_reason for the orders table.
 *
 * There is deliberately no network call, no croo-sdk import, and no polling
 * loop here. Everything operates on plain objects so it can be unit tested in
 * isolation with fake Negotiation objects and fake errors. A future poller can
 * call assessNegotiation on each in flight negotiation and, when it reports a
 * failure, call toFailureReason to fill in the order record.
 *
 * Scope note: negotiate_order returns a Negotiation, so this file reasons about
 * Negotiation status only. The Order lifecycle (statuses such as "creating" and
 * "created") is not modelled here because its full set of values is not yet
 * confirmed.
 */

/**
 * The four confirmed Negotiation status values from croo's own source. There
 * is no "settled" or "delivered" here; those belong to the later Order.
 */
export type NegotiationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/**
 * Minimal shape of a Negotiation that the failure logic needs. The real object
 * carries more fields; only the two used here are declared, and structural
 * typing lets a fuller object be passed straight in.
 */
export interface Negotiation {
  status: NegotiationStatus;
  /** Timestamp string (for example ISO 8601) after which a pending negotiation is expired. */
  expires_at: string;
}

/**
 * The one confirmed APIError code that means an immediate, synchronous failure
 * at negotiate time, before any order exists.
 */
export const PROVIDER_NOT_ACCEPTING_ORDERS = 'PROVIDER_NOT_ACCEPTING_ORDERS';

/** Machine readable classification of why an attempt failed. */
export type FailureKind =
  | 'provider_not_accepting_orders'
  | 'negotiation_rejected'
  | 'negotiation_expired'
  | 'api_error'
  | 'unknown_error';

/** Result of assessing a single Negotiation object. */
export type NegotiationVerdict =
  | { state: 'succeeded' }
  | { state: 'in_progress' }
  | { state: 'failed'; kind: FailureKind };

/**
 * Input to toFailureReason. A failure comes either from an error thrown at
 * negotiate time or from a Negotiation that assessNegotiation judged failed.
 */
export type Failure =
  | { source: 'error'; error: unknown }
  | { source: 'negotiation'; kind: FailureKind };

/**
 * Decide whether a Negotiation should be considered failed, still in progress,
 * or succeeded. Pure and side effect free.
 *
 * A negotiation is failed when it was rejected, when it is already marked
 * expired, or when it is still pending and the current time has passed its own
 * expires_at. The expiry deadline is taken from the negotiation itself, never
 * from a hardcoded timeout.
 *
 * @param negotiation the Negotiation object to assess
 * @param now the reference time, injectable so tests are deterministic
 */
export function assessNegotiation(
  negotiation: Negotiation,
  now: Date = new Date()
): NegotiationVerdict {
  switch (negotiation.status) {
    case 'accepted':
      return { state: 'succeeded' };

    case 'rejected':
      return { state: 'failed', kind: 'negotiation_rejected' };

    case 'expired':
      return { state: 'failed', kind: 'negotiation_expired' };

    case 'pending': {
      const expiresAt = Date.parse(negotiation.expires_at);
      // If expires_at cannot be parsed we cannot prove the negotiation has
      // expired, so we leave it in progress rather than guess that it failed.
      if (!Number.isNaN(expiresAt) && now.getTime() > expiresAt) {
        return { state: 'failed', kind: 'negotiation_expired' };
      }
      return { state: 'in_progress' };
    }

    default:
      // NegotiationStatus is a closed set of four confirmed values, so this is
      // unreachable for well typed input. As a runtime safeguard against an
      // unexpected value crossing the SDK boundary, treat it as still in
      // progress rather than crash or mark it failed.
      return { state: 'in_progress' };
  }
}

/**
 * Map a caught error or a determined failure into the human readable string
 * stored in the orders table failure_reason column.
 */
export function toFailureReason(failure: Failure): string {
  if (failure.source === 'error') {
    const { kind, detail } = classifyError(failure.error);
    return reasonForKind(kind, detail);
  }
  return reasonForKind(failure.kind);
}

/** Turn a failure kind (with optional diagnostic detail) into a reason string. */
function reasonForKind(kind: FailureKind, detail?: string): string {
  switch (kind) {
    case 'provider_not_accepting_orders':
      return 'provider is not accepting orders';
    case 'negotiation_rejected':
      return 'provider rejected the negotiation';
    case 'negotiation_expired':
      return 'negotiation expired without provider acceptance';
    case 'api_error':
      return detail ? `CAP API error: ${detail}` : 'CAP API error';
    case 'unknown_error':
      return detail
        ? `order placement failed due to an unexpected error: ${detail}`
        : 'order placement failed due to an unexpected error';
    default: {
      // Compile time guarantee that every FailureKind is handled above.
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Classify an error thrown at negotiate time. The one confirmed code is
 * PROVIDER_NOT_ACCEPTING_ORDERS. Any other error carrying a code is surfaced as
 * a generic API error with its code preserved, and anything else is an unknown
 * error. We never assume the meaning of a code we have not confirmed.
 */
function classifyError(error: unknown): { kind: FailureKind; detail?: string } {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);

  if (code === PROVIDER_NOT_ACCEPTING_ORDERS) {
    return { kind: 'provider_not_accepting_orders' };
  }
  if (code) {
    return { kind: 'api_error', detail: message ? `${code}: ${message}` : code };
  }
  return { kind: 'unknown_error', detail: message };
}

/** Safely read a string `code` property off an unknown thrown value. */
function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Safely read a human readable message off an unknown thrown value. */
function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  if (typeof error === 'string') {
    return error;
  }
  return undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Order settlement logic (Task: settlement polling)
 *
 * The Negotiation logic above answers "did the provider agree to do the work".
 * Once a negotiation is accepted an Order exists on chain, and this second
 * half answers "did the work actually settle". It is additive: nothing above
 * this line is changed.
 *
 * The Order shape below mirrors the real croo Order dataclass field for field
 * (snake_case, string defaults, delivery_window is the one integer). It was
 * copied from the installed package rather than guessed.
 *
 * A deliberate design choice: we do NOT branch on the Order.status string. In
 * the SDK source status is a plain str, not a closed enum like
 * NegotiationStatus was, so its full set of runtime values is not something we
 * can rely on. Instead we read the transaction hash and timestamp fields,
 * which are unambiguous: a hash is either present because that on chain step
 * happened, or it is empty because it did not. This keeps the assessment
 * robust even if the provider or the SDK introduces a status string we have
 * never seen.
 * ---------------------------------------------------------------------------
 */

/**
 * TypeScript mirror of the real croo Order dataclass. Field names are kept in
 * snake_case to match the wire and SDK shape exactly, so an Order decoded from
 * the SDK can be passed straight in without renaming. Every field is a string
 * with an empty string default except delivery_window, which is an integer.
 */
export interface Order {
  order_id: string;
  negotiation_id: string;
  chain_order_id: string;
  service_id: string;
  requester_agent_id: string;
  provider_agent_id: string;
  buyer_user_id: string;
  requester_wallet_address: string;
  provider_wallet_address: string;
  price: string;
  payment_token: string;
  delivery_window: number;
  status: string;
  reject_reason: string;
  create_tx_hash: string;
  pay_tx_hash: string;
  deliver_tx_hash: string;
  reject_tx_hash: string;
  clear_tx_hash: string;
  sla_deadline: string;
  pay_deadline: string;
  created_time: string;
  updated_time: string;
  created_at: string;
  paid_at: string;
  delivered_at: string;
  rejected_at: string;
  expired_at: string;
  fee_amount: string;
  fund_amount: string;
  fund_token: string;
  provider_fund_address: string;
}

/**
 * The stage an in flight order has reached, derived purely from which
 * transaction hashes are present. These are ordered: created comes before
 * paid, which comes before delivered.
 */
export type OrderStage = 'created' | 'paid' | 'delivered';

/**
 * Result of assessing a single Order. Terminal states (settled, rejected,
 * timed_out) mean a poller can stop; in_progress means keep polling.
 */
export type OrderVerdict =
  | { state: 'settled'; clearTxHash: string }
  | { state: 'rejected'; reason: string }
  | { state: 'in_progress'; stage: OrderStage }
  | { state: 'timed_out' };

/**
 * True when a string field actually carries a value. All Order string fields
 * default to the empty string, so "was this step reached" is simply "is the
 * field non empty". Whitespace only values are treated as absent defensively.
 */
function hasValue(field: string | undefined | null): boolean {
  return typeof field === 'string' && field.trim().length > 0;
}

/**
 * Decide the current stage of an order from its transaction hashes alone.
 * Called only after settled and rejected have been ruled out, so clear and
 * reject hashes are known to be absent here.
 *
 * - delivered: the provider has submitted the result on chain (deliver hash
 *   present) but it has not cleared yet.
 * - paid: escrow has been funded (pay hash present) but no result delivered.
 * - created: the order exists on chain but has not been paid yet.
 */
function orderStage(order: Order): OrderStage {
  if (hasValue(order.deliver_tx_hash)) {
    return 'delivered';
  }
  if (hasValue(order.pay_tx_hash)) {
    return 'paid';
  }
  return 'created';
}

/**
 * The deadline that matters at a given stage.
 *
 * Before payment (created stage) the clock that can expire the order is the
 * pay_deadline: the requester must fund escrow in time. After payment (paid or
 * delivered stage) the relevant clock is the sla_deadline: the provider must
 * deliver and the order must clear in time. We only ever compare against the
 * single deadline that applies to the current stage rather than treating both
 * as always active.
 */
function relevantDeadline(order: Order, stage: OrderStage): string {
  return stage === 'created' ? order.pay_deadline : order.sla_deadline;
}

/**
 * Assess an Order and return a terminal or in progress verdict. Pure and side
 * effect free, so it can be unit tested with plain fake objects and no SDK.
 *
 * Precedence, most decisive signal first:
 *   1. Settled: clear_tx_hash is present. The escrow has been released, which
 *      is the definition of done. This wins even if a deadline has since
 *      passed, because a cleared order cannot un settle.
 *   2. Rejected: reject_tx_hash is present, or rejected_at is set. Either one
 *      is enough; the provider (or the chain) has declined the order.
 *   3. Timed out: the deadline relevant to the current stage is in the past,
 *      with neither a clear nor a reject hash present. Expiry recorded by the
 *      server (expired_at) is also treated as a timeout, since it is an even
 *      stronger signal than a passed local deadline.
 *   4. In progress: none of the above, so report the stage reached.
 *
 * Defensive stance on deadlines: if the relevant deadline string cannot be
 * parsed we do NOT guess that the order timed out. We cannot prove expiry, so
 * we leave it in progress, mirroring how assessNegotiation refuses to treat an
 * unparseable expires_at as an expiry.
 *
 * @param order the Order object to assess
 * @param now the reference time, injectable so tests are deterministic
 */
export function assessOrder(order: Order, now: Date = new Date()): OrderVerdict {
  // 1. Settled wins outright: a released escrow is terminal and final.
  if (hasValue(order.clear_tx_hash)) {
    return { state: 'settled', clearTxHash: order.clear_tx_hash };
  }

  // 2. Rejected via either the on chain reject hash or the rejected_at stamp.
  if (hasValue(order.reject_tx_hash) || hasValue(order.rejected_at)) {
    const reason = hasValue(order.reject_reason)
      ? order.reject_reason
      : 'order rejected by provider';
    return { state: 'rejected', reason };
  }

  // 3a. A server recorded expiry is an unambiguous timeout. We reach here only
  // with no clear and no reject hash, so this cannot mask a settled order.
  if (hasValue(order.expired_at)) {
    return { state: 'timed_out' };
  }

  const stage = orderStage(order);

  // 3b. Deadline based timeout for the clock that applies to the current stage.
  const deadline = relevantDeadline(order, stage);
  if (hasValue(deadline)) {
    const deadlineMs = Date.parse(deadline);
    // Unparseable deadline: we cannot prove the order expired, so fall through
    // to in_progress rather than assume a timeout.
    if (!Number.isNaN(deadlineMs) && now.getTime() > deadlineMs) {
      return { state: 'timed_out' };
    }
  }

  // 4. Still working. Report how far it has gotten.
  return { state: 'in_progress', stage };
}

/**
 * True when a verdict is terminal, so the poller should stop. Settled,
 * rejected and timed_out are all final; only in_progress means keep going.
 */
export function isTerminalVerdict(verdict: OrderVerdict): boolean {
  return verdict.state !== 'in_progress';
}

/**
 * The minimal slice of the SDK AgentClient that the poller needs. Declaring an
 * interface rather than importing the concrete client keeps this module free
 * of any SDK dependency and lets tests pass a fake.
 *
 * The method name get_order was verified against the AgentClient class in the
 * installed croo package: `async def get_order(self, order_id: str) -> Order`.
 * It is snake_case to match the SDK surface.
 */
export interface OrderPollClient {
  get_order(orderId: string): Promise<Order>;
}

/** Tunables for pollOrderUntilSettled. All optional with safe defaults. */
export interface PollOrderOptions {
  /** Milliseconds between polls. Defaults to 3000 (3 seconds). */
  intervalMs?: number;
  /**
   * Hard safety cap on the number of get_order calls, so the loop can never
   * run forever if an order never reaches a terminal state. Defaults to 100,
   * which at the 3 second default interval covers roughly five minutes, the
   * documented upper bound of the slower provider SLA.
   */
  maxAttempts?: number;
  /** Injectable clock, so assessment inside the loop is testable. */
  now?: () => Date;
  /** Injectable sleep, so tests can run the loop without real delays. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Optional observer called after every poll with the fetched order, the
   * verdict, and the 1 based attempt number. Handy for logging or driving a
   * progress UI. Never throws into the loop: its own errors are ignored.
   */
  onPoll?: (order: Order, verdict: OrderVerdict, attempt: number) => void;
  /**
   * Optional observer for a get_order call that threw. By default a single
   * failed fetch is swallowed and polling continues on the next tick, because
   * one transient network blip should not fail an otherwise healthy in flight
   * order. The attempt still counts against maxAttempts.
   */
  onPollError?: (error: unknown, attempt: number) => void;
}

/** Default wait between polls, in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 3000;
/** Default safety cap on the number of polls. */
const DEFAULT_MAX_ATTEMPTS = 100;

/** Promise based sleep used when the caller does not inject its own. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll an order until it reaches a terminal state, then return that verdict.
 *
 * On each tick it calls the SDK's get_order and runs assessOrder. It stops and
 * returns as soon as the verdict is terminal (settled, rejected, or
 * timed_out). If the safety cap of maxAttempts is reached while the order is
 * still in progress, it returns { state: 'timed_out' }: exhausting the cap is
 * treated as a timeout so a stuck order always resolves to a terminal, failed
 * result rather than being left hanging.
 *
 * A get_order call that throws does not abort the poll by default; the error
 * is reported to onPollError (if given) and the loop continues on the next
 * tick. This keeps a single transient fetch failure from failing an order that
 * is otherwise progressing. The final thrown error, if the cap is reached
 * without ever getting a reading, still results in a timed_out verdict.
 *
 * @param client anything exposing get_order(orderId): Promise<Order>
 * @param orderId the order to watch
 * @param options interval, cap, and injectable clock / sleep / observers
 */
export async function pollOrderUntilSettled(
  client: OrderPollClient,
  orderId: string,
  options: PollOrderOptions = {}
): Promise<OrderVerdict> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let order: Order;
    try {
      order = await client.get_order(orderId);
    } catch (error) {
      // A failed read is not proof of failure. Report it and try again on the
      // next tick, unless we have run out of attempts.
      if (options.onPollError) {
        options.onPollError(error, attempt);
      }
      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
      continue;
    }

    const verdict = assessOrder(order, now());

    if (options.onPoll) {
      // The observer is advisory only; never let it break the poll loop.
      try {
        options.onPoll(order, verdict, attempt);
      } catch {
        // Intentionally ignored.
      }
    }

    if (isTerminalVerdict(verdict)) {
      return verdict;
    }

    // Still in progress. Wait before the next poll, but do not sleep after the
    // final allowed attempt since we are about to give up anyway.
    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  // The cap was exhausted without a terminal reading. Resolve to a timeout so
  // the caller can mark the order failed rather than leave it stuck.
  return { state: 'timed_out' };
}
