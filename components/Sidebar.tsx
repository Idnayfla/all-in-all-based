'use client';
import { useState } from 'react';
import { FileNode, Project } from '@/lib/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const langIcon: Record<string, string> = {
  typescript: 'TS',
  javascript: 'JS',
  tsx: 'TSX',
  jsx: 'JSX',
  html: 'HT',
  css: 'CS',
  json: 'JS',
  python: 'PY',
  default: '◻',
};

export default function Sidebar({
  files,
  activeFile,
  onSelectFile,
  projects,
  currentProject,
  onNewProject,
  onLoadProject,
  onDeleteProject,
  onRenameProject,
}: {
  files: FileNode[];
  activeFile: FileNode | null;
  onSelectFile: (f: FileNode) => void;
  projects: Project[];
  currentProject: Project | null;
  onNewProject: () => void;
  onLoadProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const startRename = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
  };

  const confirmRename = (id: string) => {
    if (editName.trim()) onRenameProject(id, editName.trim());
    setEditingId(null);
  };

  const downloadFile = (file: FileNode) => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    saveAs(blob, file.name);
  };

  const exportZip = async () => {
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${currentProject?.name ?? 'project'}.zip`);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">Projects</span>
          <button className="sidebar-new-btn" onClick={onNewProject}>
            +
          </button>
        </div>
        <div className="sidebar-projects">
          {projects.length === 0 ? (
            <div className="no-files">No projects yet.</div>
          ) : (
            [...projects]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map(p => (
                <div
                  key={p.id}
                  className={`project-item ${currentProject?.id === p.id ? 'active' : ''}`}
                  onClick={() => onLoadProject(p)}
                >
                  {editingId === p.id ? (
                    <input
                      className="rename-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={() => confirmRename(p.id)}
                      onKeyDown={e => e.key === 'Enter' && confirmRename(p.id)}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="project-hex-icon">⬡</span>
                      <span className="project-name">{p.name}</span>
                      <div className="project-actions">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            startRename(p);
                          }}
                          className="action-btn"
                          title="Rename"
                        >
                          ✎
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setPendingDeleteId(p.id);
                          }}
                          className="action-btn danger"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
          )}
        </div>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div className="sidebar-header-row">
          <span className="sidebar-header">Files</span>
          {files.length > 0 && (
            <button className="sidebar-new-btn" onClick={exportZip} title="Export as ZIP">
              ↓
            </button>
          )}
        </div>
        <div className="sidebar-files">
          {files.length === 0 ? (
            <div className="no-files">No files yet.</div>
          ) : (
            files.map(f => (
              <div
                key={f.name}
                className={`file-item ${activeFile?.name === f.name ? 'active' : ''}`}
                onClick={() => onSelectFile(f)}
              >
                <span className="file-icon">{langIcon[f.language] ?? langIcon.default}</span>
                <span className="file-name">{f.name}</span>
                <button
                  className="action-btn file-download-btn"
                  onClick={e => {
                    e.stopPropagation();
                    downloadFile(f);
                  }}
                  title="Download file"
                >
                  ↓
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      {pendingDeleteId &&
        (() => {
          const target = projects.find(p => p.id === pendingDeleteId);
          return (
            <div className="delete-confirm-overlay" onClick={() => setPendingDeleteId(null)}>
              <div className="delete-confirm-dialog" onClick={e => e.stopPropagation()}>
                <p className="delete-confirm-title">Delete project?</p>
                <p className="delete-confirm-name">⬡ {target?.name ?? 'this project'}</p>
                <p className="delete-confirm-body">
                  All files will be lost. This cannot be undone.
                </p>
                <div className="delete-confirm-actions">
                  <button
                    className="delete-confirm-cancel"
                    onClick={() => setPendingDeleteId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="delete-confirm-confirm"
                    onClick={() => {
                      onDeleteProject(pendingDeleteId);
                      setPendingDeleteId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </aside>
  );
}
