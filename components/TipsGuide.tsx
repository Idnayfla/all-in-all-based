'use client';
import { useState, useEffect } from 'react';

const TIPS = [
  {
    icon: '◈',
    title: 'Generate apps by chatting',
    body: 'Describe what you want to build — Based writes the code and previews it live.',
  },
  {
    icon: '⬡',
    title: 'Swipe between panels',
    body: 'Swipe left or right to move between Chat, Editor, and Preview.',
  },
  {
    icon: '↗',
    title: 'Share your creation',
    body: 'Tap Share to get a public link for your app — anyone can view it.',
  },
  {
    icon: '◉',
    title: 'More tools in the drawer',
    body: 'Video, Studio, Image, Notes & 3D are in the More tab on the right.',
  },
  {
    icon: '⊙',
    title: 'Based remembers you',
    body: 'Your preferences and context are saved so Based gets smarter over time.',
  },
];

const LS_KEY = 'based_tips_dismissed_v1';

export default function TipsGuide() {
  const [dismissed, setDismissed] = useState(true);
  const [idx, setIdx] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    try {
      setDismissed(!!localStorage.getItem(LS_KEY));
    } catch {}
  }, []);

  if (dismissed) return null;

  const tip = TIPS[idx];

  const next = () => {
    setAnimating(true);
    setTimeout(() => {
      setIdx(i => (i + 1) % TIPS.length);
      setAnimating(false);
    }, 180);
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(LS_KEY, '1');
    } catch {}
  };

  return (
    <div className="tips-guide">
      <div className={`tips-card${animating ? ' tips-card--out' : ''}`}>
        <div className="tips-header">
          <span className="tips-label">◈ GUIDE</span>
          <span className="tips-counter">
            {idx + 1}/{TIPS.length}
          </span>
          <button className="tips-close" onClick={dismiss} title="Dismiss">
            ✕
          </button>
        </div>
        <div className="tips-body">
          <span className="tips-icon">{tip.icon}</span>
          <div className="tips-text">
            <div className="tips-title">{tip.title}</div>
            <div className="tips-desc">{tip.body}</div>
          </div>
        </div>
        <div className="tips-footer">
          <div className="tips-dots">
            {TIPS.map((_, i) => (
              <button
                key={i}
                className={`tips-dot${i === idx ? ' active' : ''}`}
                onClick={() => {
                  setAnimating(true);
                  setTimeout(() => {
                    setIdx(i);
                    setAnimating(false);
                  }, 180);
                }}
              />
            ))}
          </div>
          <button className="tips-next" onClick={next}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
