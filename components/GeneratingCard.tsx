'use client';
import { motion } from 'framer-motion';

interface GeneratingCardProps {
  type: 'image' | 'video' | 'music';
}

const DOTS = [0, 1, 2];

export default function GeneratingCard({ type }: GeneratingCardProps) {
  const icon = type === 'image' ? '◈' : type === 'music' ? '♪' : '▸';
  const label = type === 'image' ? 'Generating image' : type === 'music' ? 'Composing music' : 'Generating video';

  return (
    <motion.div
      className="generating-card"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
    >
      <div className="generating-shimmer" />
      <div className="generating-card-body">
        <motion.span
          className="generating-icon"
          animate={{ scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {icon}
        </motion.span>
        <div className="generating-label">
          {label}
          {DOTS.map(i => (
            <motion.span
              key={i}
              className="generating-dot"
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
            >.</motion.span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
