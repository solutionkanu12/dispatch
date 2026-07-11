import { motion } from 'framer-motion';
import { dotColor } from './AgentCard.jsx';

// Same four-keyframe travel curve as the prototype's CSS @keyframes travel
// (origin -> a lifted midpoint arc -> target, shrinking and fading out as it
// lands), now driven by real Framer Motion instead of CSS custom properties.
const TIMES = [0, 0.12, 0.45, 0.82, 1];
const DURATION = 1.15;

export default function Packet({ packet, onArrive }) {
  const { origin, target } = packet;
  const midX = (origin.x + target.x) / 2;
  const midY = Math.min(origin.y, target.y) - 70;
  const dot = dotColor(packet.agentId);

  return (
    <motion.div
      style={{ position: 'fixed', left: 0, top: 0, zIndex: 60, pointerEvents: 'none' }}
      initial={{ x: origin.x, y: origin.y, scale: 0.96, rotate: -1.5, opacity: 0 }}
      animate={{
        x: [origin.x, origin.x, midX, target.x, target.x],
        y: [origin.y, origin.y, midY, target.y, target.y],
        scale: [0.96, 1, 0.9, 0.42, 0.2],
        rotate: [-1.5, 0, 2.5, 0, 0],
        opacity: [0, 1, 1, 1, 0],
      }}
      transition={{ duration: DURATION, times: TIMES, ease: [0.5, 0, 0.2, 1] }}
      onAnimationComplete={() => onArrive(packet.id)}
    >
      <div
        className="font-display flex max-w-[300px] items-center gap-2.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-2xl border px-4 py-3 text-[13px] font-medium text-cream"
        style={{
          background: '#211A14',
          borderColor: '#E8913C',
          boxShadow: '0 0 40px rgba(232,145,60,0.35), 0 12px 30px rgba(0,0,0,0.5)',
        }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        {packet.text}
      </div>
    </motion.div>
  );
}
