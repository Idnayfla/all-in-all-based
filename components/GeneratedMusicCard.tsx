'use client';
import { useRef, useState } from 'react';
import { motion } from 'framer-motion';

const BAR_HEIGHTS = Array.from({ length: 24 }, () => 6 + Math.floor(Math.random() * 22));

interface GeneratedMusicCardProps {
  url: string;
  prompt: string;
}

export default function GeneratedMusicCard({ url, prompt }: GeneratedMusicCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { void audio.play(); setPlaying(true); }
  };

  return (
    <motion.div
      className="generated-music-wrap"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
    >
      <div className="generated-music-player">
        <motion.button
          className="generated-music-btn"
          onClick={toggle}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </motion.button>
        <div className="generated-music-waveform">
          {BAR_HEIGHTS.map((h, i) => (
            <motion.div
              key={i}
              className="waveform-bar"
              animate={playing
                ? { height: ['4px', `${h}px`, '4px'] }
                : { height: '4px' }
              }
              transition={{
                duration: 0.5 + (i % 5) * 0.08,
                repeat: Infinity,
                delay: i * 0.04,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
        <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} style={{ display: 'none' }} />
      </div>
      <div className="generated-image-prompt">{prompt}</div>
      <div className="generated-image-actions">
        <a className="generated-image-download" href={url} download target="_blank" rel="noreferrer">↓ Download</a>
      </div>
    </motion.div>
  );
}
