'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import { FileNode, Project } from '@/app/page';

interface SidebarTriggerProps {
  files: FileNode[];
  activeFile: FileNode | null;
  onSelectFile: (f: FileNode) => void;
  projects: Project[];
  currentProject: Project | null;
  onNewProject: () => void;
  onLoadProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}

export default function SidebarTrigger({
  onNewProject,
  onLoadProject,
  ...props
}: SidebarTriggerProps) {
  const [open, setOpen] = useState(false);

  const handleNewProject = () => {
    onNewProject();
    setOpen(false);
  };
  const handleLoadProject = (p: Project) => {
    onLoadProject(p);
    setOpen(false);
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
      <div className="sidebar-trigger">
        <motion.div
          className="sidebar-floating-panel"
          initial={{ width: 0 }}
          animate={{ width: open ? 220 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <Sidebar {...props} onNewProject={handleNewProject} onLoadProject={handleLoadProject} />
        </motion.div>
        <button
          className="sidebar-tab"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close sidebar' : 'Open sidebar'}
        >
          <span className={`sidebar-tab-chevron${open ? ' open' : ''}`}>›</span>
        </button>
      </div>
    </>
  );
}
