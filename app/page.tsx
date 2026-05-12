'use client';

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import ChatPanel from '@/components/ChatPanel';
import EditorPanel from '@/components/EditorPanel';
import PreviewPanel from '@/components/PreviewPanel';
import SidebarTrigger from '@/components/SidebarTrigger';
import DebugPanel from '@/components/DebugPanel';
import LogoDisplay from '@/components/LogoDisplay';
import ProjectNameModal from '@/components/ProjectNameModal';
import AuthModal from '@/components/AuthModal';
import SplashScreen from '@/components/SplashScreen';
import { supabase } from '@/lib/supabase';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';

export interface FileNode {
  name: string;
  content: string;
  language: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
  | { type: 'generated-image'; url: string; prompt: string }
  | { type: 'generated-video'; url: string; prompt: string };

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

const DEFAULT_PERSONALITY = 'You are Based, the AI inside All in All Based — a sharp, witty, and direct coding assistant. You are confident, occasionally funny, and always helpful. You treat the user like a smart friend, not a customer. You get straight to the point, never over-explain, and celebrate when things work.';

export default function Home() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [files, setFiles]             = useState<FileNode[]>([]);
  const [activeFile, setActiveFile]   = useState<FileNode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectType, setProjectType] = useState('html');
  const [personality, setPersonality] = useState(DEFAULT_PERSONALITY);
  const [showSettings, setShowSettings] = useState(false);
  const [globalMemory, setGlobalMemory] = useState('');
  const [incognito, setIncognito]     = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<Message[]>([]);
  const [activePanel, setActivePanel] = useState<'chat' | 'editor' | 'preview' | 'debug'>('chat');
  const [projects, setProjects]       = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectModal, setProjectModal] = useState(false);
  const [user, setUser]               = useState<any>(null);
  const [authReady, setAuthReady]     = useState(false);
  const [showSplash, setShowSplash]   = useState(true);

  // ── Auth headers helper ──────────────────────────────────────────────────
  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    };
  }, []);

  // ── Load user data from cloud ────────────────────────────────────────────
  const loadCloudData = useCallback(async () => {
    const headers = await getHeaders();
    const [projectsRes, settingsRes] = await Promise.all([
      fetch('/api/projects', { headers }),
      fetch('/api/settings', { headers }),
    ]);
    if (projectsRes.ok) {
      const { projects } = await projectsRes.json();
      setProjects(projects ?? []);
    }
    if (settingsRes.ok) {
      const { personality: p, globalMemory: m } = await settingsRes.json();
      if (p) setPersonality(p);
      if (m) setGlobalMemory(m);
    }
  }, [getHeaders]);

  // ── Run localStorage migration on first login ────────────────────────────
  const runMigration = useCallback(async (headers: HeadersInit) => {
    const raw = localStorage.getItem('forge_projects');
    if (!raw) return;
    try {
      const localProjects = JSON.parse(raw);
      const localPersonality = localStorage.getItem('forge_personality') ?? '';
      await fetch('/api/migrate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projects: localProjects,
          personality: localPersonality,
          globalMemory: '',
        }),
      });
      localStorage.removeItem('forge_projects');
      localStorage.removeItem('forge_personality');
    } catch {
      // Migration failure: leave localStorage intact so user's data is safe
    }
  }, []);

  // ── Auth state listener ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        const headers = await getHeaders();
        // Check if first login (no cloud projects + local data exists)
        const res = await fetch('/api/projects', { headers });
        if (res.ok) {
          const { projects: cloudProjects } = await res.json();
          const hasLocalProjects = !!localStorage.getItem('forge_projects');
          if (cloudProjects.length === 0 && hasLocalProjects) {
            await runMigration(headers);
          }
        }
        await loadCloudData();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (event === 'SIGNED_IN' && currentUser) {
        const headers = await getHeaders();
        const res = await fetch('/api/projects', { headers });
        if (res.ok) {
          const { projects: cloudProjects } = await res.json();
          const hasLocalProjects = !!localStorage.getItem('forge_projects');
          if (cloudProjects.length === 0 && hasLocalProjects) {
            await runMigration(headers);
          }
        }
        await loadCloudData();
      }
      if (event === 'SIGNED_OUT') {
        setProjects([]); setCurrentProject(null);
        setFiles([]); setMessages([]); setActiveFile(null);
        setGlobalMemory(''); setPersonality(DEFAULT_PERSONALITY);
      }
    });

    return () => subscription.unsubscribe();
  }, [getHeaders, loadCloudData, runMigration]);

  // ── Memory updated event ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = async () => {
      if (!user) return;
      const headers = await getHeaders();
      const res = await fetch('/api/settings', { headers });
      if (res.ok) {
        const { globalMemory: m } = await res.json();
        setGlobalMemory(m ?? '');
      }
    };
    window.addEventListener('memory-updated', handler);
    return () => window.removeEventListener('memory-updated', handler);
  }, [user, getHeaders]);

  // ── Auto-save project on files/messages change ───────────────────────────
  useEffect(() => {
    if (!currentProject || !user) return;
    if (files.length === 0 && messages.length === 0) return;
    const strippedMessages = messages.map(m => ({
      ...m,
      content: Array.isArray(m.content)
        ? m.content.map(b => b.type === 'image' ? { type: 'text' as const, text: '[image]' } : b)
        : m.content,
    }));
    const updated: Project = { ...currentProject, files, messages: strippedMessages, updatedAt: Date.now() };
    setCurrentProject(updated);
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
    getHeaders().then(headers => {
      fetch(`/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ files, messages: strippedMessages }),
      }).catch(() => {});
    });
  }, [files, messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Project CRUD ─────────────────────────────────────────────────────────
  const newProject = () => setProjectModal(true);

  const createProject = async (name: string) => {
    setProjectModal(false);
    const headers = await getHeaders();
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) return;
    const { project } = await res.json();
    setProjects(prev => [project, ...prev]);
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

  const deleteProject = async (id: string) => {
    const headers = await getHeaders();
    fetch(`/api/projects/${id}`, { method: 'DELETE', headers }).catch(() => {});
    setProjects(prev => prev.filter(p => p.id !== id));
    if (currentProject?.id === id) {
      setCurrentProject(null); setFiles([]); setMessages([]); setActiveFile(null);
    }
  };

  const renameProject = async (id: string, name: string) => {
    const headers = await getHeaders();
    fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name }),
    }).catch(() => {});
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p));
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

  const signOut = async () => {
    await supabase.auth.signOut();
    setShowSettings(false);
  };

  // Avatar: show provider picture or initials
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const avatarInitial = (user?.email as string | undefined)?.[0]?.toUpperCase() ?? '?';

  if (!authReady) return null; // Prevent flash before session check

  return (
    <div className="app-root">
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
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
            <button className={`tab-btn tab-btn-debug ${activePanel === 'debug' ? 'active' : ''}`} onClick={() => setActivePanel('debug')} title="Debug stream">◈</button>
          </div>
          <div className="header-controls">
            <button
              className={`icon-btn ${incognito ? 'incognito-active' : ''}`}
              onClick={() => { setIncognito(s => !s); setIncognitoMessages([]); setActivePanel('chat'); }}
              title="Temp chat — no memory saved"
            >◉</button>
            <button className={`icon-btn ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(s => !s)} title="Settings" aria-label="Toggle settings">◈</button>
            {user && (
              <button
                className="user-avatar-btn"
                onClick={() => setShowSettings(s => !s)}
                title={user.email}
              >
                {avatarUrl
                  ? <img src={avatarUrl} alt="avatar" />
                  : avatarInitial}
              </button>
            )}
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
                  onChange={async e => {
                    setPersonality(e.target.value);
                    const headers = await getHeaders();
                    fetch('/api/settings', {
                      method: 'PUT',
                      headers,
                      body: JSON.stringify({ personality: e.target.value }),
                    }).catch(() => {});
                  }}
                  rows={6}
                  placeholder="Describe how Based should behave..."
                />
                <div className="settings-hint">This shapes how Based talks and thinks. Changes apply immediately.</div>
              </div>
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
                <button className="run-btn" style={{ marginTop: 8 }} onClick={async () => {
                  const headers = await getHeaders();
                  await fetch('/api/memory/save', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ memory: globalMemory }),
                  });
                }}>Save Memory</button>
              </div>
              {currentProject && (
                <div className="settings-section">
                  <label className="settings-label">Project Memory</label>
                  <textarea
                    className="settings-textarea"
                    value={currentProject.memory ?? ''}
                    onChange={async e => {
                      const updated = { ...currentProject, memory: e.target.value };
                      setCurrentProject(updated);
                      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                      const headers = await getHeaders();
                      fetch(`/api/projects/${currentProject.id}`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({ memory: e.target.value }),
                      }).catch(() => {});
                    }}
                    rows={4}
                    placeholder="Tell Based things to always remember about this project..."
                  />
                  <div className="settings-hint">Based will remember this for every message in this project.</div>
                </div>
              )}
              {user && (
                <div className="settings-section">
                  <div className="settings-hint" style={{ marginBottom: 4 }}>Signed in as {user.email}</div>
                  <button className="auth-signout-btn" onClick={signOut}>Sign Out</button>
                </div>
              )}
            </div>
          )}

          {incognito ? (
            <div className="panel panel-active">
              <div className="incognito-banner">◉ Incognito Mode — chat will be wiped when you exit</div>
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
                        if (idx >= 0) merged[idx] = newFile; else merged.push(newFile);
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
              <div className={`panel ${activePanel === 'debug' ? 'panel-active' : ''}`}>
                <DebugPanel />
              </div>
            </>
          )}
        </main>
      </div>

      <AnimatePresence>
        {projectModal && (
          <ProjectNameModal
            onConfirm={createProject}
            onCancel={() => setProjectModal(false)}
          />
        )}
        {authReady && !user && (
          <AuthModal key="auth-modal" />
        )}
      </AnimatePresence>
    </div>
  );
}
