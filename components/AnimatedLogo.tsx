'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLogoConfig } from '@/hooks/useLogoConfig';
import LogoDisplay from './LogoDisplay';
import LogoEditorModal from './LogoEditorModal';

export default function AnimatedLogo() {
  const { config, setConfig } = useLogoConfig();
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <div
        className="animated-logo-root"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <LogoDisplay config={config} />
        <AnimatePresence>
          {(isHovered || isEditing) && (
            <motion.button
              key="edit-btn"
              className="logo-edit-btn"
              onClick={() => setIsEditing(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              title="Customize logo"
              aria-label="Customize logo"
            >
              ✎
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      {isEditing && (
        <LogoEditorModal
          config={config}
          onSave={(c) => { setConfig(c); setIsEditing(false); }}
          onClose={() => setIsEditing(false)}
        />
      )}
    </>
  );
}
