'use client';
import { useState } from 'react';
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
        <button
          className="logo-edit-btn"
          onClick={() => setIsEditing(true)}
          title="Customize logo"
          aria-label="Customize logo"
          style={{ opacity: isHovered || isEditing ? 1 : 0 }}
        >
          ✎
        </button>
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
