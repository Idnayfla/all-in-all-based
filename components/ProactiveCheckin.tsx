'use client';
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface Props {
  projectName: string;
  onContinue: () => void;
  onDismiss: () => void;
}

export default function ProactiveCheckin({ projectName, onContinue, onDismiss }: Props) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      className="checkin-card"
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      <div className="checkin-header">
        <span className="checkin-icon">◈</span>
        <span className="checkin-label">Welcome back.</span>
      </div>
      <div className="checkin-body">
        You were working on{' '}
        <strong className="checkin-project-name">&ldquo;{projectName}&rdquo;</strong>
        {' '}— want to pick up where you left off?
      </div>
      <div className="checkin-actions">
        <button className="checkin-continue" onClick={onContinue}>Continue →</button>
        <button className="checkin-dismiss" onClick={onDismiss}>Not now</button>
      </div>
      <div className="checkin-timer-bar">
        <div className="checkin-timer-progress" />
      </div>
    </motion.div>
  );
}
