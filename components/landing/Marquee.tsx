'use client';

import { motion } from 'framer-motion';
import styles from './Marquee.module.css';

const ITEMS = [
  '⬡ KNOW YOU',
  '⬡ BUILD FOR YOU',
  '⬡ ALWAYS HERE',
  '⬡ REMEMBER EVERYTHING',
  '⬡ NEVER JUDGE',
  '⬡ STAY WITH YOU',
  '⬡ OVERATTACHED',
  '⬡ YOUR COMPANION',
];

interface Props {
  speed?: number; // seconds for one full pass
  reverse?: boolean;
}

export default function Marquee({ speed = 28, reverse = false }: Props) {
  const doubled = [...ITEMS, ...ITEMS];
  const direction = reverse ? ['0%', '50%'] : ['0%', '-50%'];

  return (
    <div className={styles.root} aria-hidden="true">
      <motion.div
        className={styles.track}
        animate={{ x: direction }}
        transition={{ duration: speed, repeat: Infinity, ease: 'linear' }}
      >
        {doubled.map((item, i) => (
          <span key={i} className={styles.item}>
            {item}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
