'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChatPanel from '@/components/ChatPanel';
import EditorPanel from '@/components/EditorPanel';
import PreviewPanel from '@/components/PreviewPanel';
import SidebarTrigger from '@/components/SidebarTrigger';
import DebugPanel from '@/components/DebugPanel';
import LogoDisplay from '@/components/LogoDisplay';
import ProjectNameModal from '@/components/ProjectNameModal';
import AuthModal from '@/components/AuthModal';
import SplashScreen from '@/components/SplashScreen';
import PersonalityPanel from '@/components/PersonalityPanel';
import MemoryManager, { parseMemories } from '@/components/MemoryManager';
import ThemeCustomizer, { AppTheme, DEFAULT_THEME, applyTheme, loadTheme, saveThemeLocally } from '@/components/ThemeCustomizer';
import { supabase } from '@/lib/supabase';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';
import CompanionDrawer from '@/components/CompanionDrawer';

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
  const isExplicitSignOut             = useRef(false);
  const [showSplash, setShowSplash]   = useState(true);
  const [theme, setTheme]             = useState<AppTheme>(DEFAULT_THEME);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCompanion, setShowCompanion] = useState(false);
  const [isCompanionGenerating, setIsCompanionGenerating] = useState(false);

  // ── Project cache helpers (localStorage) ────────────────────────────────
  const PROJECTS_CACHE_KEY = 'based_projects_cache';
  const saveProjectsCache = (list: Project[]) => {
    try { localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(list)); } catch {}
  };
  const loadProjectsCache = (): Project[] => {
    try {
      const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  // ── Apply theme on mount from localStorage ──────────────────────────────
  useEffect(() => {
    const saved = loadTheme();
    setTheme(saved);
    applyTheme(saved);
  }, []);

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
    // Show cached projects immediately so the UI isn't blank on refresh
    const cached = loadProjectsCache();
    if (cached.length > 0) setProjects(cached);

    const headers = await getHeaders();
    const [projectsRes, settingsRes] = await Promise.all([
      fetch('/api/projects', { headers }),
      fetch('/api/settings', { headers }),
    ]);
    if (projectsRes.ok) {
      const { projects } = await projectsRes.json();
      const list = projects ?? [];
      setProjects(list);
      saveProjectsCache(list);
    } else {
      console.error('[Based] GET /api/projects failed:', projectsRes.status, await projectsRes.text().catch(() => ''));
    }
    if (settingsRes.ok) {
      const { personality: p, globalMemory: m, theme: t } = await settingsRes.json();
      if (p) setPersonality(p);
      if (m) setGlobalMemory(m);
      if (t && Object.keys(t).length > 0) {
        const merged = { ...DEFAULT_THEME, ...t };
        setTheme(merged);
        applyTheme(merged);
        saveThemeLocally(merged);
      }
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
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        // Stale or invalid refresh token — clear it so the auth modal shows cleanly
        await supabase.auth.signOut();
        setAuthReady(true);
        return;
      }
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
        if (isExplicitSignOut.current) {
          // User clicked Sign Out — clear everything
          isExplicitSignOut.current = false;
          setProjects([]); setCurrentProject(null);
          setFiles([]); setMessages([]); setActiveFile(null);
          setGlobalMemory(''); setPersonality(DEFAULT_PERSONALITY);
        }
        // Token expiry SIGNED_OUT: don't wipe projects — auth modal appears
        // and user can re-login to re-sync. Projects stay visible from cache.
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
    // Never overwrite persisted files with an empty array — guards against timing edge cases
    if (files.length === 0 && (currentProject.files?.length ?? 0) > 0) return;
    const strippedMessages = messages.map(m => ({
      ...m,
      content: Array.isArray(m.content)
        ? m.content.map(b => b.type === 'image' ? { type: 'text' as const, text: '[image]' } : b)
        : m.content,
    }));
    const updated: Project = { ...currentProject, files, messages: strippedMessages, updatedAt: Date.now() };
    setCurrentProject(updated);
    setProjects(prev => {
      const next = prev.map(p => p.id === updated.id ? updated : p);
      saveProjectsCache(next);
      return next;
    });
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

    // Generate ID on client so local and cloud share the same ID from the start
    const id = crypto.randomUUID();
    const newProject: Project = {
      id,
      name: name.trim(),
      files: [],
      messages: [],
      updatedAt: Date.now(),
      memory: '',
    };

    // Save to localStorage immediately — survives refresh regardless of Supabase
    const cached = loadProjectsCache();
    saveProjectsCache([newProject, ...cached]);

    // Update UI immediately
    setProjects(prev => [newProject, ...prev]);
    setCurrentProject(newProject);
    setFiles([]); setMessages([]); setActiveFile(null); setActivePanel('chat');

    // Sync to Supabase in background — log errors so we can debug
    getHeaders().then(async (headers) => {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: name.trim(), id }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error('[Based] Project cloud sync failed:', res.status, body.error);
        }
      } catch (e) {
        console.error('[Based] Project cloud sync network error:', e);
      }
    }).catch(e => console.error('[Based] getHeaders error:', e));
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
    setProjects(prev => {
      const next = prev.filter(p => p.id !== id);
      saveProjectsCache(next);
      return next;
    });
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
    isExplicitSignOut.current = true;
    await supabase.auth.signOut();
    setShowSettings(false);
  };

  // Avatar: show provider picture or initials
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const avatarInitial = (user?.email as string | undefined)?.[0]?.toUpperCase() ?? '?';

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
          <AnimatePresence>
          {showSettings && (
            <motion.div
              className="settings-panel"
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 32 }}
            >
              <div className="settings-header">⬡ Settings</div>
              <div className="settings-section">
                <label className="settings-label">Appearance</label>
                <ThemeCustomizer
                  theme={theme}
                  onChange={async (next) => {
                    setTheme(next);
                    applyTheme(next);
                    saveThemeLocally(next);
                    const headers = await getHeaders();
                    fetch('/api/settings', {
                      method: 'PUT',
                      headers,
                      body: JSON.stringify({ theme: next }),
                    }).catch(() => {});
                  }}
                />
              </div>
              <div className="settings-section">
                <label className="settings-label">AI Personality</label>
                <PersonalityPanel
                  onPersonalityChange={async (modifier) => {
                    setPersonality(modifier);
                    const headers = await getHeaders();
                    fetch('/api/settings', {
                      method: 'PUT',
                      headers,
                      body: JSON.stringify({ personality: modifier }),
                    }).catch(() => {});
                  }}
                />
              </div>
              <div className="settings-section">
                <label className="settings-label">Global Memory</label>
                <div className="settings-hint" style={{ marginBottom: 8 }}>Auto-updated after each conversation. Based remembers this across all projects.</div>
                <div className="memory-compiled-preview">
                  {parseMemories(globalMemory).length > 0
                    ? parseMemories(globalMemory).map((line, i) => (
                        <div key={i} className="memory-compiled-line">{i + 1}) {line}</div>
                      ))
                    : <div className="memory-compiled-line" style={{ color: 'var(--text3)' }}>No memories yet.</div>
                  }
                </div>
                <button className="memory-manage-btn" onClick={() => setShowMemoryManager(true)}>
                  ⬡ Manage Memories
                </button>
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
            </motion.div>
          )}
          </AnimatePresence>

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
              <div className="no-project-sub">You describe it. Based builds it.</div>
              <div className="no-project-features">
                HTML &nbsp;·&nbsp; Canvas games &nbsp;·&nbsp; Web apps &nbsp;·&nbsp; Tools &nbsp;·&nbsp; Dashboards
              </div>
              <button className="new-project-btn-large" onClick={newProject}>+ New Project</button>
              <div className="no-project-hint">Sign in free · Projects save to your account</div>
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
        {authReady && !user && !showSplash && (
          <AuthModal key="auth-modal" />
        )}
      </AnimatePresence>

      {showMemoryManager && (
        <MemoryManager
          memory={globalMemory}
          onSave={async (mem) => {
            setGlobalMemory(mem);
            const headers = await getHeaders();
            fetch('/api/memory/save', {
              method: 'POST',
              headers,
              body: JSON.stringify({ memory: mem }),
            }).catch(() => {});
          }}
          onClose={() => setShowMemoryManager(false)}
        />
      )}

      <AnimatePresence>
        {createError && (
          <motion.div
            className="create-error-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            {createError}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={`companion-trigger${showCompanion ? ' companion-trigger--open' : ''}${isCompanionGenerating ? ' companion-trigger--responding' : ''}`}
        onClick={() => setShowCompanion(s => !s)}
        aria-label="Open AI Companion"
      >
        <span className="companion-trigger-label">B</span>
        <span className="companion-trigger-ring companion-trigger-ring--1" />
        <span className="companion-trigger-ring companion-trigger-ring--2" />
      </button>

      <AnimatePresence>
        {showCompanion && (
          <CompanionDrawer
            personality={personality}
            memory={globalMemory}
            files={files}
            onClose={() => setShowCompanion(false)}
            onGeneratingChange={setIsCompanionGenerating}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
