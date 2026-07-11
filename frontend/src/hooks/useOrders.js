import { useCallback, useEffect, useRef, useState } from 'react';

// Real order status values from server/services/orderStore.ts's OrderStatus
// type / the schema.sql CHECK constraint. 'queued' and 'routed' are the two
// non-terminal states worth continuing to poll for.
const TERMINAL_STATUSES = new Set(['settled', 'failed']);

const POLL_INTERVAL_MS = 2500;

function hasNonTerminalOrder(orders) {
  return orders.some((order) => !TERMINAL_STATUSES.has(order.status));
}

/**
 * Polls GET /api/orders, per docs/dispatch-architecture.md section 2: fetch
 * once on mount to hydrate the ledger, then keep polling every 2-3s only
 * while at least one order is non-terminal (queued or routed), and stop
 * polling once everything has settled or failed.
 *
 * Returns the real OrderRow[] shape unmodified (id, request_text, agent_id,
 * status, price_usdc, cap_order_ref, settlement_proof, result_payload,
 * failure_reason, created_at, settled_at), most recent first, exactly as
 * server/routes/orders.ts returns it.
 */
export function useOrders() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch('/api/orders');
      const body = await res.json();
      if (!mountedRef.current) return;

      if (!res.ok) {
        setError((body && body.error) || `Failed to load orders (status ${res.status}).`);
        return;
      }

      setError(null);
      setOrders(Array.isArray(body) ? body : []);

      if (hasNonTerminalOrder(body)) {
        clearTimer();
        timerRef.current = setTimeout(fetchOnce, POLL_INTERVAL_MS);
      }
    } catch (networkError) {
      if (!mountedRef.current) return;
      setError(
        networkError instanceof Error
          ? `Could not reach Dispatch: ${networkError.message}`
          : 'Could not reach Dispatch.'
      );
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // Lets a caller (App, right after a successful dispatch) force an immediate
  // refetch instead of waiting out the current poll interval, so a freshly
  // placed order shows up in the ledger without a visible delay.
  const refetchNow = useCallback(() => {
    clearTimer();
    fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    mountedRef.current = true;
    fetchOnce();
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [fetchOnce]);

  return { orders, isLoading, error, refetchNow };
}
