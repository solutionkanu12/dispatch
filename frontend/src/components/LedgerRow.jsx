import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { dotColor } from './AgentCard.jsx';

/**
 * Visual treatment per real order status (server/services/orderStore.ts's
 * OrderStatus: 'queued' | 'routed' | 'settled' | 'failed'). 'queued' is part
 * of the schema but is not currently observable through the API: the dispatch
 * route awaits placement before ever responding, so by the time a client can
 * see an order it is already 'routed' or 'failed' (see server/routes/dispatch.ts).
 * It is still handled correctly here in case that timing ever changes.
 */
const STATUS_META = {
  queued: { label: 'Queued', color: '#8A7F72', pulse: true },
  routed: { label: 'Routing', color: '#E8913C', pulse: true },
  settled: { label: 'Settled', color: '#6FB98F', pulse: false },
  failed: { label: 'Failed', color: '#E2574C', pulse: false },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: '#8A7F72', pulse: false };

  if (status === 'settled') {
    return (
      <span className="flex min-w-[74px] items-center justify-end gap-1.5 text-[12.5px] font-semibold text-green">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="#6FB98F"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Settled
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="flex min-w-[74px] items-center justify-end gap-1.5 text-[12.5px] font-semibold text-fail">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="#E2574C"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Failed
      </span>
    );
  }

  return (
    <span
      className="flex min-w-[74px] items-center justify-end gap-1.5 text-[12.5px] font-semibold"
      style={{ color: meta.color }}
    >
      <span
        className={'h-[7px] w-[7px] rounded-full' + (meta.pulse ? ' animate-livePulse' : '')}
        style={{ background: meta.color }}
      />
      {meta.label}
    </span>
  );
}

export default function LedgerRow({ order, agent }) {
  const agentName = agent ? agent.name : order.agent_id;
  const dot = dotColor(order.agent_id);
  const prevStatusRef = useRef(order.status);
  const [flash, setFlash] = useState(false);

  // A background flash on status change (not just on first mount) so a live
  // transition, e.g. routed -> settled, is visible while the page is open,
  // not only inferred from the badge having quietly changed.
  useEffect(() => {
    if (prevStatusRef.current !== order.status) {
      prevStatusRef.current = order.status;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1800);
      return () => clearTimeout(t);
    }
  }, [order.status]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className="px-0 py-0.5"
    >
      <motion.div
        animate={{ backgroundColor: flash ? 'rgba(232,145,60,0.14)' : 'rgba(232,145,60,0)' }}
        transition={{ duration: flash ? 0.2 : 1.6, ease: 'easeOut' }}
        className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-[18px] rounded-xl px-5 py-3.5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="h-[9px] w-[9px] shrink-0 rounded-full"
            style={{ background: dot, boxShadow: `0 0 8px ${dot}` }}
          />
          <span
            className="truncate text-[14px] text-cream"
            title={order.failure_reason || order.request_text}
          >
            {order.request_text}
          </span>
        </div>
        <span className="text-[13px] font-medium text-muted">{agentName}</span>
        <span className="font-display min-w-[66px] text-right text-[13px] text-cream2">
          {order.price_usdc.toFixed(2)} USDC
        </span>
        <StatusBadge status={order.status} />
      </motion.div>
      {order.status === 'failed' && order.failure_reason && (
        <div className="truncate px-5 pb-1.5 text-[11.5px] text-muted2" title={order.failure_reason}>
          {order.failure_reason}
        </div>
      )}
    </motion.div>
  );
}
