import { useCallback, useState } from 'react';
import { apiUrl } from '../lib/apiUrl.js';

/**
 * POST wrapper for /api/dispatch.
 *
 * The real endpoint (server/routes/dispatch.ts) returns one of four shapes,
 * distinguished here by whether the body carries an `id`:
 *
 *   201 { id, status: 'routed', agent_id, cap_order_ref }
 *     order row exists, placement succeeded
 *   502 { id, status: 'failed', agent_id, failure_reason }
 *     order row exists, placement failed (this is the only outcome
 *     currently reachable, since no CapService is registered yet via
 *     setCapService(); see server/services/capService.ts)
 *   400 { status: 'error', error }
 *     request_text missing or empty, no order row was created
 *   429 { status: 'error', error }
 *     express-rate-limit throttled this IP, no order row was created
 *   500 { status: 'error', error }
 *     server-side failure before/without creating an order row
 *
 * Only the first two carry an id and belong in the ledger; the last three are
 * surfaced as a form-level error message with no ledger entry, since no order
 * was ever persisted.
 */
export function useDispatch() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const dispatch = useCallback(async (requestText) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/dispatch'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_text: requestText }),
      });

      let body;
      try {
        body = await res.json();
      } catch {
        const message = `Dispatch failed: server returned ${res.status} with no readable body.`;
        setError(message);
        return { ok: false, message };
      }

      if (body && typeof body.id === 'string') {
        // Order row exists (routed or failed at placement time). Either way
        // it belongs in the ledger; let the caller and the polling hook take
        // it from here.
        return {
          ok: true,
          order: {
            id: body.id,
            status: body.status,
            agent_id: body.agent_id,
            cap_order_ref: body.cap_order_ref ?? null,
            failure_reason: body.failure_reason ?? null,
          },
        };
      }

      const message =
        (body && typeof body.error === 'string' && body.error) ||
        `Dispatch failed with status ${res.status}.`;
      setError(message);
      return { ok: false, message };
    } catch (networkError) {
      const message =
        networkError instanceof Error
          ? `Could not reach Dispatch: ${networkError.message}`
          : 'Could not reach Dispatch.';
      setError(message);
      return { ok: false, message };
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { dispatch, isSubmitting, error, clearError };
}
