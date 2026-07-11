import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';

// Per-agent dot color. The prototype hardcoded two colors for its two
// hardcoded agents; this maps by id so any seeded agent still gets a color
// instead of the frontend inventing new agents. Anything beyond the two
// currently seeded agents (config/agents.json) falls back to the ember
// default rather than guessing a new color scheme.
const DOT_COLOR_BY_ID = {
  verimath: '#E8913C',
  chainguard: '#FFA94D',
};

function dotColor(agentId) {
  return DOT_COLOR_BY_ID[agentId] || '#E8913C';
}

function Stat({ label, value, accent }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-bg px-3.5 py-2.5">
      <div className="mb-1 text-[11px] font-medium text-muted2">{label}</div>
      <div className={'font-display text-[15px] font-semibold ' + (accent ? 'text-ember' : 'text-cream')}>
        {value}
      </div>
    </div>
  );
}

/**
 * Per-provider live stat card, matching the prototype's AgentCard exactly:
 * name + tag, a static "Live" pulse badge (Dispatch only ever routes to this
 * fixed small set of known live agents, so there is no online/offline signal
 * to poll for; this mirrors the product positioning rather than a fabricated
 * status feed), and three stats.
 *
 * `agent` is the real row from GET /api/agents (id, name, service_tags,
 * price_usdc, sla_minutes, ...). `orderCount` is derived by the caller from
 * the real orders list, not a fake starting count. `justArrived` toggles the
 * card-lift glow when a packet has just landed on this card.
 */
const AgentCard = forwardRef(function AgentCard({ agent, orderCount, justArrived }, ref) {
  const tag = agent.service_tags.join(' · ');

  return (
    <motion.div
      ref={ref}
      className="relative flex-1 overflow-hidden rounded-[20px] border border-line bg-panel px-6 py-[22px] shadow-md2"
      animate={
        justArrived
          ? { y: [0, -7, 0], borderColor: ['#2E2620', '#E8913C', '#2E2620'] }
          : { y: 0 }
      }
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      style={{ boxShadow: justArrived ? '0 0 40px rgba(232,145,60,0.35), 0 12px 30px rgba(0,0,0,0.5)' : undefined }}
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="font-display mb-[3px] text-[19px] font-semibold tracking-[-0.01em]">
            {agent.name}
          </div>
          <div className="truncate text-[13.5px] text-muted" title={tag}>
            {tag}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[7px] rounded-full border border-line bg-bg px-[11px] py-[5px]">
          <span className="h-[7px] w-[7px] animate-livePulse rounded-full bg-green" />
          <span className="text-[11.5px] font-semibold text-cream2">Live</span>
        </div>
      </div>
      <div className="flex gap-2.5">
        <Stat label="Per call" value={agent.price_usdc.toFixed(2) + ' USDC'} />
        <Stat label="Delivery" value={`up to ${agent.sla_minutes} min`} />
        <Stat label="Orders" value={orderCount} accent />
      </div>
    </motion.div>
  );
});

export default AgentCard;
export { dotColor };
