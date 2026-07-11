import { motion } from 'framer-motion';

/**
 * The "seal-burst" ring that flashes at an agent card when a packet lands,
 * matching the prototype's @keyframes ring via real Framer Motion.
 */
export default function ReceiveRing({ point, color = '#E8913C' }) {
  return (
    <motion.div
      style={{
        position: 'fixed',
        left: point.x,
        top: point.y,
        marginLeft: -6,
        marginTop: -6,
        width: 12,
        height: 12,
        borderRadius: '50%',
        border: `2.5px solid ${color}`,
        zIndex: 55,
        pointerEvents: 'none',
      }}
      initial={{ opacity: 0.9, scale: 0.3 }}
      animate={{ opacity: 0, scale: 2.8 }}
      transition={{ duration: 0.65, ease: [0.2, 0.8, 0.3, 1] }}
    />
  );
}
