'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';

interface GeneratedVideoCardProps {
  url: string;
  prompt: string;
}

export default function GeneratedVideoCard({ url, prompt }: GeneratedVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <motion.div
      className="generated-video-wrap"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
    >
      <div className="generated-video-thumb">
        {playing ? (
          <video src={url} autoPlay controls className="generated-video-player" />
        ) : (
          <motion.button
            className="generated-video-play-btn"
            onClick={() => setPlaying(true)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            aria-label="Play video"
          >
            ▶
          </motion.button>
        )}
      </div>
      <div className="generated-image-prompt">{prompt}</div>
      <div className="generated-image-actions">
        <a className="generated-image-download" href={url} download target="_blank" rel="noreferrer">↓ Download</a>
      </div>
    </motion.div>
  );
}
