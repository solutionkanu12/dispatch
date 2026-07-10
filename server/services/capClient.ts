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
