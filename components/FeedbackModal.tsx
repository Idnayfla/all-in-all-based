'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TYPES = [
  { value: 'bug',        label: '◈ Bug' },
  { value: 'suggestion', label: '⬡ Suggestion' },
  { value: 'general',    label: '· General' },
];

export default function FeedbackModal({
  onClose,
  userEmail,
}: {
  onClose: () => void;
  userEmail?: string;
}) {
  const [type, setType]       = useState('general');
  const [message, setMessage] = useState('');
  const [email, setEmail]     = useState(userEmail ?? '');
  const [sending, setSending] = useState(false);
  const [done, setDone]       = useState(false);

  const submit = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, email, type }),
      });
      setDone(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="feedback-backdrop" onClick={onClose}>
      <motion.div
        className="feedback-modal"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="feedback-header">
          <span className="feedback-title">⬡ Feedback</span>
          <button className="feedback-close" onClick={onClose}>✕</button>
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              className="feedback-done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <div className="feedback-done-icon">◈</div>
              <div className="feedback-done-text">Received — thank you.</div>
              <div className="feedback-done-sub">This helps improve Based for everyone.</div>
              <button className="feedback-submit" onClick={onClose}>Close</button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="feedback-type-row">
                {TYPES.map(t => (
                  <button
                    key={t.value}
                    className={`feedback-type-btn${type === t.value ? ' active' : ''}`}
                    onClick={() => setType(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <textarea
                className="feedback-textarea"
                placeholder="What's on your mind? A bug, idea, or anything else..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                autoFocus
              />

              <input
                className="feedback-email"
                type="email"
                placeholder="Email (optional — if you'd like a reply)"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />

              <div className="feedback-footer">
                <span className="feedback-hint">Sent to <a href="mailto:husgogogo@gmail.com">husgogogo@gmail.com</a></span>
                <button
                  className="feedback-submit"
                  onClick={submit}
                  disabled={!message.trim() || sending}
                >
                  {sending ? '◈ Sending…' : '→ Send'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
