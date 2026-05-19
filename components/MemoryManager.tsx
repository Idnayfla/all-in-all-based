'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
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
  onClose: () => void;
}

export default function MemoryManager({ memory, onSave, onClose }: Props) {
  const items = parseMemories(memory);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const openAdd = () => {
    setDraft('');
    setEditIndex(null);
    setEditOpen(true);
  };
  const openEdit = (i: number) => {
    setDraft(items[i]);
    setEditIndex(i);
    setEditOpen(true);
  };
  const closeEdit = () => {
    setEditOpen(false);
    setDraft('');
  };

  const handleSave = () => {
    const text = draft.trim();
    if (!text) return;
    const next =
      editIndex === null
        ? [...items, text]
        : items.map((item, i) => (i === editIndex ? text : item));
    onSave(stringifyMemories(next));
    closeEdit();
  };

  const handleDelete = (i: number) => {
    onSave(stringifyMemories(items.filter((_, idx) => idx !== i)));
  };

  return createPortal(
    <>
      {/* Backdrop — closes window */}
      <motion.div
        className="memwin-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />

      {/* Centered window — x/y must carry the -50% centering because
          Framer Motion's inline transform replaces any CSS transform */}
      <motion.div
        className="memwin"
        initial={{ opacity: 0, scale: 0.94, x: '-50%', y: 'calc(-50% - 14px)' }}
        animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <div className="memwin-header">
          <span className="memwin-title">⬡ Global Memory</span>
          <button className="memwin-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="memwin-body">
          {items.length === 0 ? (
            <div className="memwin-empty">
              No memories yet — Based will learn about you as you chat.
            </div>
          ) : (
            <div className="memwin-list">
              {items.map((item, i) => (
                <motion.div
                  key={i}
                  className="memory-chip"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.14, delay: i * 0.025 }}
                  layout
                >
                  <span className="memory-chip-num">{i + 1}</span>
                  <span className="memory-chip-text">{item}</span>
                  <div className="memory-chip-actions">
                    <button className="memory-chip-btn" onClick={() => openEdit(i)} title="Edit">
                      ✎
                    </button>
                    <button
                      className="memory-chip-btn memory-chip-delete"
                      onClick={() => handleDelete(i)}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="memwin-footer">
          <span className="memwin-count">
            {items.length} {items.length === 1 ? 'memory' : 'memories'}
          </span>
          <button className="memwin-add-btn" onClick={openAdd}>
            + Add memory
          </button>
        </div>
      </motion.div>

      {/* Edit / Add sub-modal — sibling of window so it escapes its stacking context */}
      <AnimatePresence>
        {editOpen && (
          <>
            <motion.div
              className="memory-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={closeEdit}
            />
            <motion.div
              className="memory-modal"
              initial={{ opacity: 0, scale: 0.92, x: '-50%', y: 'calc(-50% - 8px)' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
              exit={{ opacity: 0, scale: 0.92, x: '-50%', y: 'calc(-50% - 8px)' }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="memory-modal-title">
                {editIndex === null ? 'Add Memory' : 'Edit Memory'}
              </div>
              <textarea
                className="memory-modal-input"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="e.g. prefers dark mode interfaces"
                rows={3}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
                  if (e.key === 'Escape') closeEdit();
                }}
              />
              <div className="memory-modal-actions">
                <button className="memory-modal-cancel" onClick={closeEdit}>
                  Cancel
                </button>
                <button className="memory-modal-save" onClick={handleSave} disabled={!draft.trim()}>
                  {editIndex === null ? 'Add' : 'Save'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

export { parseMemories };
