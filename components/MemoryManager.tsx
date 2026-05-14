'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function parseMemories(raw: string): string[] {
  return raw
    .split('\n')
    .map(line => line.replace(/^\d+[\)\.]\s*/, '').trim())
    .filter(Boolean);
}

function stringifyMemories(items: string[]): string {
  return items.map((item, i) => `${i + 1}) ${item}`).join('\n');
}

interface Props {
  memory: string;
  onSave: (memory: string) => void;
}

export default function MemoryManager({ memory, onSave }: Props) {
  const items = parseMemories(memory);
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = adding new
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const openAdd = () => {
    setDraft('');
    setEditIndex(null);
    setModalOpen(true);
  };

  const openEdit = (i: number) => {
    setDraft(items[i]);
    setEditIndex(i);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setDraft('');
  };

  const handleSave = () => {
    const text = draft.trim();
    if (!text) return;
    let next: string[];
    if (editIndex === null) {
      next = [...items, text];
    } else {
      next = items.map((item, i) => (i === editIndex ? text : item));
    }
    onSave(stringifyMemories(next));
    closeModal();
  };

  const handleDelete = (i: number) => {
    const next = items.filter((_, idx) => idx !== i);
    onSave(stringifyMemories(next));
  };

  return (
    <div className="memory-manager">
      {items.length === 0 && (
        <div className="memory-empty">No memories yet — Based will learn about you as you chat.</div>
      )}

      <div className="memory-list">
        {items.map((item, i) => (
          <motion.div
            key={i}
            className="memory-chip"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, delay: i * 0.03 }}
            layout
          >
            <span className="memory-chip-text">{item}</span>
            <div className="memory-chip-actions">
              <button className="memory-chip-btn" onClick={() => openEdit(i)} title="Edit">✎</button>
              <button className="memory-chip-btn memory-chip-delete" onClick={() => handleDelete(i)} title="Delete">×</button>
            </div>
          </motion.div>
        ))}
      </div>

      <button className="memory-add-btn" onClick={openAdd}>+ Add memory</button>

      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              className="memory-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closeModal}
            />
            <motion.div
              className="memory-modal"
              initial={{ opacity: 0, scale: 0.92, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="memory-modal-title">
                {editIndex === null ? 'Add Memory' : 'Edit Memory'}
              </div>
              <textarea
                className="memory-modal-input"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="e.g. User prefers dark mode interfaces"
                rows={3}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
                  if (e.key === 'Escape') closeModal();
                }}
              />
              <div className="memory-modal-actions">
                <button className="memory-modal-cancel" onClick={closeModal}>Cancel</button>
                <button className="memory-modal-save" onClick={handleSave} disabled={!draft.trim()}>
                  {editIndex === null ? 'Add' : 'Save'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
