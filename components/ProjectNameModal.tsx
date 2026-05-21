'use client';
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ProjectNameModalProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  defaultValue?: string;
  title?: string;
}

export default function ProjectNameModal({
  onConfirm,
  onCancel,
  defaultValue = '',
  title = 'New Project',
}: ProjectNameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = inputRef.current?.value.trim();
      if (val) onConfirm(val);
    }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={e => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.div
        className="modal-box"
        initial={{ opacity: 0, scale: 0.94, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: -12 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <div className="modal-title">{title}</div>
        <input
          ref={inputRef}
          className="modal-input"
          defaultValue={defaultValue}
          placeholder="Project name..."
          onKeyDown={handleKey}
          maxLength={60}
        />
        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-confirm"
            onClick={() => {
              const val = inputRef.current?.value.trim();
              if (val) onConfirm(val);
            }}
          >
            Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
