'use client';

import { useState, useEffect } from 'react';
import ChatPanel from '@/components/ChatPanel';
import EditorPanel from '@/components/EditorPanel';
import PreviewPanel from '@/components/PreviewPanel';
import Sidebar from '@/components/Sidebar';

export interface FileNode {
  name: string;
  content: string;
  language: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
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
  const [activePanel, setActivePanel] = useState<'chat' | 'editor' | 'preview'>('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);

  // Load projects from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('forge_projects');
    if (saved) setProjects(JSON.parse(saved));
  }, []);

  useEffect(() => {
  const saved = localStorage.getItem('forge_personality');
  if (saved) setPersonality(saved);
}, []);

  // Auto-save current project
  useEffect(() => {
    if (!currentProject || (files.length === 0 && messages.length === 0)) return;
    const updated: Project = {
      ...currentProject,
      files,
      messages,
      updatedAt: Date.now(),
    };
    setCurrentProject(updated);
    const allProjects = projects.map(p => p.id === updated.id ? updated : p);
    const exists = projects.find(p => p.id === updated.id);
    const final = exists ? allProjects : [...projects, updated];
    setProjects(final);
    localStorage.setItem('forge_projects', JSON.stringify(final));
  }, [files, messages]);

  const newProject = () => {
    const project: Project = {
      id: Date.now().toString(),
      name: `Project ${projects.length + 1}`,
      files: [],
      messages: [],
      updatedAt: Date.now(),
    };
    const updated = [...projects, project];
    setProjects(updated);
    localStorage.setItem('forge_projects', JSON.stringify(updated));
    setCurrentProject(project);
    setFiles([]);
    setMessages([]);
    setActiveFile(null);
    setActivePanel('chat');
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
      setCurrentProject(null);
      setFiles([]);
      setMessages([]);
      setActiveFile(null);
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
          <span className="logo-icon">⬡</span>
          <span className="logo-text">BASED</span>
          <span className="logo-sub">All in All Based</span>
        </div>
        {currentProject && (
          <div className="project-name-display">
            {currentProject.name}
          </div>
        )}
        <nav className="header-nav">
          <button className={`nav-btn ${activePanel === 'chat' ? 'active' : ''}`} onClick={() => setActivePanel('chat')}>Chat</button>
          <button className={`nav-btn ${activePanel === 'editor' ? 'active' : ''}`} onClick={() => setActivePanel('editor')}>Editor</button>
          <button className={`nav-btn ${activePanel === 'preview' ? 'active' : ''}`} onClick={() => setActivePanel('preview')}>Preview</button>
          <button className={`nav-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(s => !s)}>Settings</button>
        </nav>
        <div className="header-status">
          {isGenerating && <span className="status-dot generating">●</span>}
          <span className="status-text">{isGenerating ? 'Generating...' : 'Ready'}</span>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
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

{showSettings && (
  <div className="settings-panel">
    <div className="settings-header">⬡ Settings</div>
    <div className="settings-section">
      <label className="settings-label">AI Personality</label>
      <textarea
        className="settings-textarea"
        value={personality}
        onChange={e => {
          setPersonality(e.target.value);
          localStorage.setItem('forge_personality', e.target.value);
        }}
        rows={6}
        placeholder="Describe how Forge should behave..."
      />
      <div className="settings-hint">This shapes how Forge talks and thinks. Changes apply immediately.</div>
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
          placeholder="Tell Forge things to always remember about this project... e.g. 'This is a todo app using vanilla JS. Always use dark theme.'"
        />
        <div className="settings-hint">Forge will remember this context for every message in this project.</div>
      </div>
    )}
  </div>
)}

        <main className="main-content">
          {!currentProject ? (
            <div className="no-project">
              <div className="no-project-icon">⬡</div>
              <div className="no-project-title">Welcome to Forge</div>
              <div className="no-project-sub">Create a new project to get started.</div>
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
    </div>
  );
}