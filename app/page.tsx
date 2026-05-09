'use client';

import { useState, useEffect } from 'react';
import ChatPanel from '@/components/ChatPanel';
import EditorPanel from '@/components/EditorPanel';
import PreviewPanel from '@/components/PreviewPanel';
import SidebarTrigger from '@/components/SidebarTrigger';
import DebugPanel from '@/components/DebugPanel';
import LogoDisplay from '@/components/LogoDisplay';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';

export interface FileNode {
  name: string;
  content: string;
  language: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export function contentToString(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export interface Project {
  id: string;
  name: string;
  files: FileNode[];
  messages: Message[];
  updatedAt: number;
  memory?: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectType, setProjectType] = useState('html');
  const [personality, setPersonality] = useState('You are Based, the AI inside All in All Based — a sharp, witty, and direct coding assistant. You are confident, occasionally funny, and always helpful. You treat the user like a smart friend, not a customer. You get straight to the point, never over-explain, and celebrate when things work.');
  const [showSettings, setShowSettings] = useState(false);
  const [globalMemory, setGlobalMemory] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<Message[]>([]);
  const [activePanel, setActivePanel] = useState<'chat' | 'editor' | 'preview'>('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('forge_projects');
    if (saved) setProjects(JSON.parse(saved));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('forge_personality');
    if (saved) setPersonality(saved);
  }, []);

  useEffect(() => {
  const handler = () => fetchMemory();
  window.addEventListener('memory-updated', handler);
  return () => window.removeEventListener('memory-updated', handler);
  }, []);

  const fetchMemory = () => {
  fetch('/api/memory')
    .then(r => r.json())
    .then(d => setGlobalMemory(d.memory ?? ''));
};

useEffect(() => { fetchMemory(); }, []);

  useEffect(() => {
    if (!currentProject || (files.length === 0 && messages.length === 0)) return;
    const strippedMessages = messages.map(m => ({
      ...m,
      content: Array.isArray(m.content)
        ? m.content.map(b => b.type === 'image' ? { type: 'text' as const, text: '[image]' } : b)
        : m.content,
    }));
    const updated: Project = { ...currentProject, files, messages: strippedMessages, updatedAt: Date.now() };
    setCurrentProject(updated);
    const allProjects = projects.map(p => p.id === updated.id ? updated : p);
    const exists = projects.find(p => p.id === updated.id);
    const final = exists ? allProjects : [...projects, updated];
    setProjects(final);
    localStorage.setItem('forge_projects', JSON.stringify(final));
  }, [files, messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const newProject = () => {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    const project: Project = {
      id: Date.now().toString(),
      name: name.trim(),
      files: [], messages: [], updatedAt: Date.now(),
    };
    const updated = [...projects, project];
    setProjects(updated);
    localStorage.setItem('forge_projects', JSON.stringify(updated));
    setCurrentProject(project);
    setFiles([]); setMessages([]); setActiveFile(null); setActivePanel('chat');
  };

  const loadProject = (project: Project) => {
    setCurrentProject(project);
    setFiles(project.files);
    setMessages(project.messages);
    setActiveFile(project.files[0] ?? null);
    setActivePanel('chat');
  };

  const deleteProject = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    localStorage.setItem('forge_projects', JSON.stringify(updated));
    if (currentProject?.id === id) {
      setCurrentProject(null); setFiles([]); setMessages([]); setActiveFile(null);
    }
  };

  const renameProject = (id: string, name: string) => {
    const updated = projects.map(p => p.id === id ? { ...p, name } : p);
    setProjects(updated);
    localStorage.setItem('forge_projects', JSON.stringify(updated));
    if (currentProject?.id === id) setCurrentProject(prev => prev ? { ...prev, name } : prev);
  };

  const updateFile = (updated: FileNode) => {
    setFiles(prev => {
      const exists = prev.find(f => f.name === updated.name);
      if (exists) return prev.map(f => f.name === updated.name ? updated : f);
      return [...prev, updated];
    });
    setActiveFile(updated);
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="logo">
          <LogoDisplay config={LOGO_DEFAULTS} />
          {currentProject && <span className="project-name-display">{currentProject.name}</span>}
        </div>
        <nav className="header-nav">
          <div className="tab-switcher">
            <button className={`tab-btn ${activePanel === 'chat' ? 'active' : ''}`} onClick={() => setActivePanel('chat')}>Chat</button>
            <button className={`tab-btn ${activePanel === 'editor' ? 'active' : ''}`} onClick={() => setActivePanel('editor')}>Editor</button>
            <button className={`tab-btn ${activePanel === 'preview' ? 'active' : ''}`} onClick={() => setActivePanel('preview')}>Preview</button>
          </div>
          <div className="header-controls">
            <button
              className={`icon-btn ${incognito ? 'incognito-active' : ''}`}
              onClick={() => { setIncognito(s => !s); setIncognitoMessages([]); setActivePanel('chat'); }}
              title="Temp chat — no memory saved"
            >🕵️</button>
            <button className={`icon-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(s => !s)} title="Settings" aria-label="Toggle settings">⚙</button>
            <div className="header-status">
              <span className={`status-dot ${isGenerating ? 'generating' : 'ready'}`}>●</span>
              <span className="status-text">{isGenerating ? 'Generating...' : 'Ready'}</span>
            </div>
          </div>
        </nav>
      </header>

      <div className="app-body">
        <SidebarTrigger
          files={files}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          projects={projects}
          currentProject={currentProject}
          onNewProject={newProject}
          onLoadProject={loadProject}
          onDeleteProject={deleteProject}
          onRenameProject={renameProject}
        />

        <main className="main-content">
          {showSettings && (
            <div className="settings-panel">
              <div className="settings-header">⬡ Settings</div>
              <div className="settings-section">
                <label className="settings-label">AI Personality</label>
                <textarea
                  className="settings-textarea"
                  value={personality}
                  onChange={e => { setPersonality(e.target.value); localStorage.setItem('forge_personality', e.target.value); }}
                  rows={6}
                  placeholder="Describe how Based should behave..."
                />
                <div className="settings-hint">This shapes how Based talks and thinks. Changes apply immediately.</div>
                <div className="settings-section">
                  <label className="settings-label">Global Memory</label>
                  <textarea
                    className="settings-textarea"
                    value={globalMemory}
                    onChange={e => setGlobalMemory(e.target.value)}
                    rows={8}
                    placeholder="Based will learn about you as you chat..."
                  />
                  <div className="settings-hint">Auto-updated after each conversation. Based remembers this across all projects.</div>
                  <button className="run-btn" style={{marginTop: 8}} onClick={async () => {
                    await fetch('/api/memory/save', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ memory: globalMemory }),
                    });
                  }}>Save Memory</button>
                </div>
              </div>
              {currentProject && (
                <div className="settings-section">
                  <label className="settings-label">Project Memory</label>
                  <textarea
                    className="settings-textarea"
                    value={currentProject.memory ?? ''}
                    onChange={e => {
                      const updated = { ...currentProject, memory: e.target.value };
                      setCurrentProject(updated);
                      const all = projects.map(p => p.id === updated.id ? updated : p);
                      setProjects(all);
                      localStorage.setItem('forge_projects', JSON.stringify(all));
                    }}
                    rows={4}
                    placeholder="Tell Based things to always remember about this project..."
                  />
                  <div className="settings-hint">Based will remember this for every message in this project.</div>
                            </div>
                          )}
                        </div>
                      )}

          {incognito ? (
            <div className="panel panel-active">
              <div className="incognito-banner">🕵️ Incognito Mode — chat will be wiped when you exit</div>
              <ChatPanel
                messages={incognitoMessages}
                setMessages={setIncognitoMessages}
                files={[]}
                onFilesUpdate={() => {}}
                isGenerating={isGenerating}
                setIsGenerating={setIsGenerating}
                personality={personality}
                memory=""
                incognito={true}
              />
            </div>
          ) : !currentProject ? (
            <div className="no-project">
              <div className="chat-empty-logo" aria-hidden="true">B&gt;</div>
              <div className="no-project-title">BASED</div>
              <div className="no-project-sub">Open a project or start a new one.</div>
              <button className="new-project-btn-large" onClick={newProject}>+ New Project</button>
            </div>
          ) : (
            <>
              <div className={`panel ${activePanel === 'chat' ? 'panel-active' : ''}`}>
                <ChatPanel
                  messages={messages}
                  setMessages={setMessages}
                  files={files}
                  onFilesUpdate={(newFiles, type) => {
                    setFiles(prev => {
                      const merged = [...prev];
                      newFiles.forEach(newFile => {
                        const idx = merged.findIndex(f => f.name === newFile.name);
                        if (idx >= 0) merged[idx] = newFile;
                        else merged.push(newFile);
                      });
                      return merged;
                    });
                    if (newFiles.length > 0) setActiveFile(newFiles[0]);
                    if (type) setProjectType(type);
                  }}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                  personality={personality}
                  memory={currentProject?.memory ?? ''}
                  incognito={incognito}
                />
              </div>
              <div className={`panel ${activePanel === 'editor' ? 'panel-active' : ''}`}>
                <EditorPanel activeFile={activeFile} onFileUpdate={updateFile} />
              </div>
              <div className={`panel ${activePanel === 'preview' ? 'panel-active' : ''}`}>
                <PreviewPanel files={files} projectType={projectType} />
              </div>
            </>
          )}
        </main>
      </div>
      <DebugPanel enabled={true} />
    </div>
  );
}