import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgentCard from './components/AgentCard.jsx';
import RequestForm from './components/RequestForm.jsx';
import Ledger from './components/Ledger.jsx';
import Packet from './components/Packet.jsx';
import ReceiveRing from './components/ReceiveRing.jsx';
import Footer from './components/Footer.jsx';
import { useOrders } from './hooks/useOrders.js';
import { useDispatch } from './hooks/useDispatch.js';
import { classifyPreview } from './lib/classifyPreview.js';
import dispatcherImage from './assets/dispatcher.jpg';

let packetSeq = 0;

export default function App() {
  const [agents, setAgents] = useState([]);
  const [agentsError, setAgentsError] = useState(null);

  const { orders, error: ordersError, refetchNow } = useOrders();
  const { dispatch, isSubmitting, error: dispatchError } = useDispatch();

  const [flying, setFlying] = useState([]);
  const [rings, setRings] = useState([]);
  const [lift, setLift] = useState({ agentId: null, key: 0 });

  const inputRef = useRef(null);
  const cardRefs = useRef({});
  const liftCounter = useRef(0);

  // The real seeded agent registry (config/agents.json via GET /api/agents).
  // Fetched once; this list is not runtime-writable per the architecture doc,
  // so there is no need to poll it.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (Array.isArray(body)) setAgents(body);
        else setAgentsError('Unexpected response loading agents.');
      })
      .catch((err) => {
        if (!cancelled) setAgentsError(err instanceof Error ? err.message : 'Failed to load agents.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const agentsById = useMemo(() => {
    const map = {};
    for (const agent of agents) map[agent.id] = agent;
    return map;
  }, [agents]);

  const orderCountByAgent = useMemo(() => {
    const counts = {};
    for (const order of orders) {
      counts[order.agent_id] = (counts[order.agent_id] || 0) + 1;
    }
    return counts;
  }, [orders]);

  const settledStats = useMemo(() => {
    let total = 0;
    let volume = 0;
    for (const order of orders) {
      if (order.status === 'settled') {
        total += 1;
        volume += order.price_usdc;
      }
    }
    return { total, volume };
  }, [orders]);

  const getOrigin = () => {
    const el = inputRef.current;
    if (!el) return { x: 120, y: 120 };
    const r = el.getBoundingClientRect();
    return { x: r.left + 28, y: r.top + r.height / 2 };
  };

  const getTarget = (agentId) => {
    const el = cardRefs.current[agentId];
    if (!el) return getOrigin();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const handleSubmit = useCallback(
    (text) => {
      if (agents.length === 0) return; // no real agent to target yet

      const previewAgentId = classifyPreview(text);
      packetSeq += 1;
      const packetId = `p${packetSeq}`;

      setFlying((f) => [
        ...f,
        {
          id: packetId,
          text,
          agentId: previewAgentId,
          origin: getOrigin(),
          target: getTarget(previewAgentId),
        },
      ]);

      // Fire the real request in parallel with the travel animation. As soon
      // as we know a real order row exists, pull it into the ledger
      // immediately rather than waiting for the packet's fixed travel time or
      // the next scheduled poll tick.
      dispatch(text).then((result) => {
        if (result.ok) refetchNow();
      });
    },
    [agents, dispatch, refetchNow]
  );

  const handleArrive = useCallback((packetId) => {
    setFlying((prev) => {
      const packet = prev.find((p) => p.id === packetId);
      if (packet) {
        liftCounter.current += 1;
        setLift({ agentId: packet.agentId, key: liftCounter.current });
        setRings((r) => [...r, { id: packet.id, point: packet.target }]);
        setTimeout(() => {
          setRings((r) => r.filter((x) => x.id !== packet.id));
        }, 670);
      }
      return prev.filter((p) => p.id !== packetId);
    });
  }, []);

  const liveAgentCount = agents.length;

  return (
    <div className="relative min-h-screen">
      {/* hero atmospheric photo */}
      <div className="pointer-events-none absolute right-0 top-0 z-0 h-[640px] w-[58%]">
        <div
          className="hero-photo h-full w-full bg-cover opacity-50"
          style={{ backgroundImage: `url(${dispatcherImage})`, backgroundPosition: 'center 30%' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(90deg,#0E0B08 0%,rgba(14,11,8,0.6) 30%,transparent 70%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg,transparent 55%,#0E0B08 100%)' }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[960px] px-7">
        {/* nav */}
        <header className="flex items-center justify-between py-7">
          <div className="flex items-center gap-[11px]">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-line2 bg-panel2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4 6l6 6-6 6" stroke="#F5EFE6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 6l6 6-6 6" stroke="#E8913C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-display text-[19px] font-bold tracking-[-0.02em]">Dispatch</span>
          </div>
          <div className="flex gap-[26px] text-[13.5px] font-medium text-muted">
            <span>
              <b className="font-display font-semibold text-cream">{settledStats.total}</b> settled
            </span>
            <span>
              <b className="font-display font-semibold text-cream">{settledStats.volume.toFixed(2)}</b> USDC
              routed
            </span>
          </div>
        </header>

        {/* hero */}
        <section className="pb-[54px] pt-[60px]">
          <div className="mb-[26px] inline-flex items-center gap-2 rounded-full border border-line bg-panel px-[14px] py-[6px]">
            <span className="animate-livePulse h-[6px] w-[6px] rounded-full bg-green" />
            <span className="text-[12.5px] font-medium text-cream2">
              Routing to {liveAgentCount} live agent{liveAgentCount === 1 ? '' : 's'} on CROO
            </span>
          </div>
          <h1 className="font-display mb-[22px] max-w-[640px] text-[58px] font-bold leading-[1.02] tracking-[-0.035em]">
            Say what you need.
            <br />
            We decide who does it.
          </h1>
          <p className="mb-9 max-w-[460px] text-[18px] leading-[1.55] text-cream2">
            Dispatch routes your request to the right live agent on CROO, pays for it, and returns
            the result.
          </p>

          <RequestForm
            ref={inputRef}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            error={dispatchError || agentsError}
          />
        </section>

        {/* routes to */}
        <section className="mb-10">
          <div className="mb-[14px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted2">
            Routes to
          </div>
          <div className="flex gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                ref={(el) => {
                  cardRefs.current[agent.id] = el;
                }}
                agent={agent}
                orderCount={orderCountByAgent[agent.id] || 0}
                justArrived={lift.agentId === agent.id}
              />
            ))}
          </div>
        </section>

        {/* ledger */}
        <section className="mb-[70px]">
          <div className="mb-[14px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted2">
            Live ledger
          </div>
          {ordersError && <p className="mb-3 text-[13px] text-fail">{ordersError}</p>}
          <Ledger orders={orders} agentsById={agentsById} />
        </section>
      </div>

      <Footer />

      {flying.map((packet) => (
        <Packet key={packet.id} packet={packet} onArrive={handleArrive} />
      ))}
      {rings.map((ring) => (
        <ReceiveRing key={ring.id} point={ring.point} />
      ))}
    </div>
  );
}
