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
import ThemeCustomizer, {
  AppTheme,
  DEFAULT_THEME,
  applyTheme,
  loadTheme,
  saveThemeLocally,
} from '@/components/ThemeCustomizer';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';
import { useSwipePanels } from '@/hooks/useSwipePanels';
import PricingModal from '@/components/PricingModal';
import LandingPage from '@/components/LandingPage';
import FeedbackModal from '@/components/FeedbackModal';
import ReferralPanel from '@/components/ReferralPanel';
import VideoEditorPanel from '@/components/VideoEditorPanel';
import StudioPanel from '@/components/StudioPanel';
import ImageStudioPanel from '@/components/ImageStudioPanel';
import NotesPanel from '@/components/NotesPanel';
import ThreeDStudio from '@/components/ThreeDStudio';
import ProactiveCheckin from '@/components/ProactiveCheckin';
import WallpaperCropper from '@/components/WallpaperCropper';
import { track, identifyUser } from '@/lib/posthog';

export interface FileNode {
  name: string;
  content: string;
  language: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      data: string;
    }
  | { type: 'generated-image'; url: string; prompt: string }
  | { type: 'generated-video'; url: string; prompt: string }
  | { type: 'generated-music'; url: string; prompt: string }
  | { type: 'clarify'; question: string; options: string[] }
  | { type: 'error'; message: string; prompt?: string; actualError?: string };

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

const DEFAULT_PERSONALITY =
  'You are Based, the AI inside All in All Based — a sharp, witty, and direct coding assistant. You are confident, occasionally funny, and always helpful. You treat the user like a smart friend, not a customer. You get straight to the point, never over-explain, and celebrate when things work.';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectType, setProjectType] = useState('html');
  const [personality, setPersonality] = useState(DEFAULT_PERSONALITY);
  const [personalitySettings, setPersonalitySettings] = useState<
    import('@/components/PersonalityPanel').PersonalitySettings | undefined
  >(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [globalMemory, setGlobalMemory] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<Message[]>([]);
  const [activePanel, setActivePanel] = useState<
    'chat' | 'editor' | 'preview' | 'debug' | 'video' | 'studio' | 'image' | 'notes' | '3d'
  >('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  useSwipePanels(activePanel, setActivePanel, !incognito && !!currentProject);
  const [projectModal, setProjectModal] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareId, setShareId] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [showGalleryPublish, setShowGalleryPublish] = useState(false);
  const [galleryAuthorName, setGalleryAuthorName] = useState('');
  const [galleryPublished, setGalleryPublished] = useState(false);
  const [apiKeys, setApiKeys] = useState<
    {
      id: string;
      name: string;
      created_at: string;
      last_used_at: string | null;
      calls_this_month: number;
    }[]
  >([]);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string>('');
  const isExplicitSignOut = useRef(false);
  const currentProjectRef = useRef<Project | null>(null);
  useEffect(() => {
    currentProjectRef.current = currentProject;
  }, [currentProject]);

  useEffect(() => {
    track('panel_switched', { panel: activePanel });
  }, [activePanel]);
  const [showSplash, setShowSplash] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<{
    tier: 'free' | 'pro';
    status: string;
    generationsUsed: number;
    periodStart: string | null;
    periodEnd: string | null;
  }>({ tier: 'free', status: 'active', generationsUsed: 0, periodStart: null, periodEnd: null });
  const [showPricing, setShowPricing] = useState(false);
  const [pricingReason, setPricingReason] = useState<'generations' | 'projects' | 'upgrade'>(
    'upgrade'
  );
  const [showFeedback, setShowFeedback] = useState(false);
  const [checkin, setCheckin] = useState<{
    id: string;
    name: string;
    fromDevice?: 'mobile' | 'tablet' | 'desktop';
  } | null>(null);
  const [aiModel, setAiModelState] = useState<'based' | 'free'>('based');
  const [persona, setPersona] =
    useState<import('@/components/PersonaSwitcher').PersonaKey>('based');
  const setAiModel = (m: 'based' | 'free') => {
    setAiModelState(m);
    try {
      localStorage.setItem('based_ai_model', m);
    } catch {}
  };
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [wallpaperBlur, setWallpaperBlur] = useState(0);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  // ── Project cache helpers (localStorage) ────────────────────────────────
  const PROJECTS_CACHE_KEY = 'based_projects_cache';
  const LAST_PROJECT_KEY = 'based_last_project';
  const saveProjectsCache = (list: Project[]) => {
    try {
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(list));
    } catch {}
  };
  const loadProjectsCache = (): Project[] => {
    try {
      const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const saveLastProject = (id: string, name: string) => {
    try {
      localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ id, name, at: Date.now() }));
    } catch {}
  };

  // Load cached projects immediately on mount so they show before auth resolves
  useEffect(() => {
    const cached = loadProjectsCache();
    if (cached.length > 0) setProjects(cached);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore AI model preference ──────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('based_ai_model');
    if (saved === 'free' || saved === 'based') setAiModelState(saved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply theme on mount from localStorage ──────────────────────────────
  useEffect(() => {
    const saved = loadTheme();
    setTheme(saved);
    applyTheme(saved);
  }, []);

  // ── Wallpaper: load from localStorage and apply ──────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('based_wallpaper');
    if (saved) {
      setWallpaper(saved);
      applyWallpaper(saved);
    }
    const savedBlur = parseInt(localStorage.getItem('based_wallpaper_blur') ?? '0');
    if (!isNaN(savedBlur)) setWallpaperBlur(savedBlur);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyWallpaper(url: string | null) {
    document.body.style.backgroundImage = '';
    if (url) {
      document.documentElement.classList.add('has-wallpaper');
    } else {
      document.documentElement.classList.remove('has-wallpaper');
    }
  }

  /** Resize + compress a raw dataUrl then save as wallpaper. */
  function saveWallpaperFromDataUrl(rawDataUrl: string) {
    const img = new Image();
    img.onload = () => {
      const MAX = 1920;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setWallpaper(dataUrl);
      applyWallpaper(dataUrl);
      try {
        localStorage.setItem('based_wallpaper', dataUrl);
      } catch {}
    };
    img.src = rawDataUrl;
  }

  function handleWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setCropperSrc(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleWallpaperClear() {
    setWallpaper(null);
    applyWallpaper(null);
    localStorage.removeItem('based_wallpaper');
  }

  // ── Capture ?ref= referral code from URL ─────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      try {
        localStorage.setItem('based_pending_ref', ref.toUpperCase());
      } catch {}
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Capture ?remix= from gallery page ───────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const remixId = params.get('remix');
    if (remixId) {
      try {
        localStorage.setItem('based_pending_remix', remixId);
      } catch {}
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleRemix = useCallback(async (remixShareId: string, headers: HeadersInit) => {
    try {
      const res = await fetch(`/api/gallery/remix/${remixShareId}`, { headers });
      if (!res.ok) return;
      const { projectName, files: remixFiles } = await res.json();
      const id = crypto.randomUUID();
      const project: Project = {
        id,
        name: `${projectName} (remix)`,
        files: remixFiles,
        messages: [],
        updatedAt: Date.now(),
        memory: '',
      };
      const cached = loadProjectsCache();
      saveProjectsCache([project, ...cached]);
      setProjects(prev => [project, ...prev]);
      setCurrentProject(project);
      setFiles(remixFiles);
      setMessages([]);
      setActiveFile(remixFiles[0] ?? null);
      setActivePanel('preview');
      setShareUrl('');
      setShareId('');
      setGalleryPublished(false);
      fetch('/api/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: project.name, id }),
      }).catch(() => {});
      fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ files: remixFiles }),
      }).catch(() => {});
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle return from Stripe checkout ──────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      setSubscription(s => ({ ...s, tier: 'pro' }));
    }
  }, []);

  // ── Write interrupted-session marker on abrupt exit (refresh / tab close) ─
  useEffect(() => {
    const handleUnload = () => {
      const p = currentProjectRef.current;
      if (!p) return;
      try {
        localStorage.setItem(
          'based_interrupted',
          JSON.stringify({ id: p.id, name: p.name, at: Date.now() })
        );
      } catch {}
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proactive check-in: offer to resume last project ────────────────────
  useEffect(() => {
    if (!user || !authReady || currentProject) return;
    try {
      // Abrupt exit (refresh / close mid-session) — no time guard needed
      const interrupted = localStorage.getItem('based_interrupted');
      if (interrupted) {
        const { id, name } = JSON.parse(interrupted);
        localStorage.removeItem('based_interrupted');
        setCheckin({ id, name });
        return;
      }
      // New session (came back after 3+ minutes)
      const raw = localStorage.getItem(LAST_PROJECT_KEY);
      if (!raw) return;
      const { id, name, at } = JSON.parse(raw) as { id: string; name: string; at: number };
      if (Date.now() - at < 3 * 60 * 1000) return; // same session — skip
      setCheckin({ id, name });
    } catch {}
  }, [user, authReady, currentProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // dev-only console helpers
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const w = window as Window & {
      __triggerCheckin?: () => void;
      __simulateInterrupt?: () => void;
    };
    w.__triggerCheckin = () => {
      const raw = localStorage.getItem(LAST_PROJECT_KEY);
      if (!raw) {
        console.warn('[checkin] no last project in localStorage');
        return;
      }
      const { id, name } = JSON.parse(raw);
      setCheckin({ id, name });
    };
    // simulate abrupt exit then reload to test interrupted flow
    w.__simulateInterrupt = () => {
      const p = currentProjectRef.current;
      if (!p) {
        console.warn('[checkin] no active project');
        return;
      }
      localStorage.setItem(
        'based_interrupted',
        JSON.stringify({ id: p.id, name: p.name, at: Date.now() })
      );
      console.log('[checkin] interrupted marker set — refresh to trigger check-in');
    };
    return () => {
      delete w.__triggerCheckin;
      delete w.__simulateInterrupt;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth headers helper ──────────────────────────────────────────────────
  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    };
  }, []);

  // ── Cross-device heartbeat ───────────────────────────────────────────────
  function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
    const ua = navigator.userAgent;
    if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
    if (/iphone|ipod|android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // Write heartbeat immediately on load and on every project switch, then every 30s
  useEffect(() => {
    if (!user) return;
    const write = async () => {
      try {
        const h = await getHeaders();
        const p = currentProjectRef.current;
        await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { ...(h as Record<string, string>), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceType: getDeviceType(),
            projectId: p?.id ?? null,
            projectName: p?.name ?? null,
          }),
        });
      } catch {}
    };
    write(); // fires immediately — catches project switches without waiting for interval
    const interval = setInterval(write, 30_000);
    return () => clearInterval(interval);
  }, [user, currentProject, getHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  // On load: check if another device was recently active with a project
  useEffect(() => {
    if (!user || !authReady || currentProject) return;
    try {
      // Skip when local check-in will already fire
      if (localStorage.getItem('based_interrupted')) return;
      const raw = localStorage.getItem(LAST_PROJECT_KEY);
      if (raw) {
        const { at } = JSON.parse(raw) as { at: number };
        if (Date.now() - at >= 3 * 60 * 1000) return;
      }
    } catch {}
    let cancelled = false;
    (async () => {
      try {
        const h = await getHeaders();
        const res = await fetch(`/api/heartbeat?current=${getDeviceType()}`, {
          headers: h as HeadersInit,
        });
        if (!res.ok || cancelled) return;
        const { heartbeat } = await res.json();
        if (!heartbeat?.project_id || cancelled) return;
        setCheckin({
          id: heartbeat.project_id,
          name: heartbeat.project_name,
          fromDevice: heartbeat.device_type,
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authReady, currentProject]); // eslint-disable-line react-hooks/exhaustive-deps

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
      console.error(
        '[Based] GET /api/projects failed:',
        projectsRes.status,
        await projectsRes.text().catch(() => '')
      );
    }
    if (settingsRes.ok) {
      const {
        personality: p,
        globalMemory: m,
        theme: t,
        subscriptionTier,
        subscriptionStatus,
        generationsUsed,
        subscriptionPeriodStart,
        subscriptionPeriodEnd,
      } = await settingsRes.json();
      const tier = subscriptionTier ?? 'free';
      setSubscription({
        tier,
        status: subscriptionStatus ?? 'active',
        generationsUsed: generationsUsed ?? 0,
        periodStart: subscriptionPeriodStart ?? null,
        periodEnd: subscriptionPeriodEnd ?? null,
      });
      localStorage.setItem('based_sub_tier', tier);

      // Stripe sync is intentionally NOT run automatically on load.
      // Webhooks keep the DB in sync; the manual Re-sync button handles edge cases.
      // Auto-sync was causing the DB to be overwritten when manually testing free tier.

      if (p) {
        try {
          const parsed = JSON.parse(p);
          if (parsed && typeof parsed === 'object' && 'tone' in parsed) {
            setPersonalitySettings(parsed);
          } else {
            setPersonality(p);
          }
        } catch {
          setPersonality(p);
        }
      }
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
      setAuthToken(session?.access_token ?? '');
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setAuthToken(session?.access_token ?? '');
      if (event === 'SIGNED_IN' && currentUser) {
        identifyUser(currentUser.id, { email: currentUser.email });
        track('signed_in');
        const headers = await getHeaders();
        const res = await fetch('/api/projects', { headers });
        if (res.ok) {
          const { projects: cloudProjects } = await res.json();
          const hasLocalProjects = !!localStorage.getItem('forge_projects');
          if (cloudProjects.length === 0 && hasLocalProjects) {
            await runMigration(headers);
          }
        }
        // Claim pending referral code if present
        const pendingRef = localStorage.getItem('based_pending_ref');
        if (pendingRef) {
          fetch('/api/referral/claim', {
            method: 'POST',
            headers,
            body: JSON.stringify({ code: pendingRef }),
          })
            .then(r => r.ok && localStorage.removeItem('based_pending_ref'))
            .catch(() => {});
        }
        await loadCloudData();
        // Fork a gallery project if remix was pending
        const pendingRemix = localStorage.getItem('based_pending_remix');
        if (pendingRemix) {
          localStorage.removeItem('based_pending_remix');
          handleRemix(pendingRemix, headers);
        }
      }
      if (event === 'SIGNED_OUT') {
        if (isExplicitSignOut.current) {
          // User clicked Sign Out — clear everything
          isExplicitSignOut.current = false;
          setProjects([]);
          setCurrentProject(null);
          setFiles([]);
          setMessages([]);
          setActiveFile(null);
          setGlobalMemory('');
          setPersonality(DEFAULT_PERSONALITY);
        }
        // Token expiry SIGNED_OUT: don't wipe projects — auth modal appears
        // and user can re-login to re-sync. Projects stay visible from cache.
      }
    });

    return () => subscription.unsubscribe();
  }, [getHeaders, loadCloudData, runMigration]);

  // ── Refresh cloud data when window regains focus or Android app resumes ──
  useEffect(() => {
    const onFocus = () => {
      if (user) loadCloudData();
    };
    // visibilitychange catches Android resume (window.focus is unreliable there)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && user) loadCloudData();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, loadCloudData]);

  // ── Generation events ────────────────────────────────────────────────────
  useEffect(() => {
    const onLimit = () => {
      setPricingReason('generations');
      setShowPricing(true);
    };
    const onUsed = () => setSubscription(s => ({ ...s, generationsUsed: s.generationsUsed + 1 }));
    window.addEventListener('generation-limit-reached', onLimit);
    window.addEventListener('generation-used', onUsed);
    return () => {
      window.removeEventListener('generation-limit-reached', onLimit);
      window.removeEventListener('generation-used', onUsed);
    };
  }, []);

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
        ? m.content.map(b => (b.type === 'image' ? { type: 'text' as const, text: '[image]' } : b))
        : m.content,
    }));
    const updated: Project = {
      ...currentProject,
      files,
      messages: strippedMessages,
      updatedAt: Date.now(),
    };
    setCurrentProject(updated);
    setProjects(prev => {
      const next = prev.map(p => (p.id === updated.id ? updated : p));
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
  const newProject = () => {
    if (subscription.tier === 'free' && projects.length >= 3) {
      setPricingReason('projects');
      setShowPricing(true);
      return;
    }
    setProjectModal(true);
  };

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
    setFiles([]);
    setMessages([]);
    setActiveFile(null);
    setActivePanel('chat');
    setCheckin(null);
    setShareUrl('');
    setPersona('based');
    saveLastProject(id, name.trim());
    setTimeout(() => setPendingPrompt(''), 100);

    // Sync to Supabase in background — log errors so we can debug
    getHeaders()
      .then(async headers => {
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
      })
      .catch(e => console.error('[Based] getHeaders error:', e));
  };

  const loadProject = (project: Project) => {
    setCurrentProject(project);
    setFiles(project.files);
    setMessages(project.messages);
    setActiveFile(project.files[0] ?? null);
    setActivePanel('chat');
    setShareUrl('');
    setShareId('');
    setGalleryPublished(false);
    setCheckin(null);
    setPersona('based');
    saveLastProject(project.id, project.name);
  };

  const deleteProject = (id: string) => {
    setProjects(prev => {
      const next = prev.filter(p => p.id !== id);
      saveProjectsCache(next);
      return next;
    });
    if (currentProject?.id === id) {
      setCurrentProject(null);
      setFiles([]);
      setMessages([]);
      setActiveFile(null);
    }
    getHeaders()
      .then(headers => {
        fetch(`/api/projects/${id}`, { method: 'DELETE', headers }).catch(() => {});
      })
      .catch(() => {});
  };

  const shareProject = async () => {
    if (!currentProject || !files.length || isSharing) return;
    setIsSharing(true);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch('/api/share', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          files,
          projectName: currentProject.name,
          projectId: currentProject.id,
        }),
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.url) {
        const full = `https://getbased.dev${data.url}`;
        setShareUrl(full);
        setShareId(data.id ?? '');
        setGalleryPublished(false);
        setIsSharing(false); // unblock UI before share dialog
        if (navigator.share) {
          navigator.share({ title: currentProject.name, url: full }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(full).catch(() => {});
        }
      } else {
        console.error('[share]', data.error);
        setIsSharing(false);
        alert('Share failed: ' + (data.error ?? 'Unknown error'));
      }
    } catch (e: unknown) {
      clearTimeout(timeout);
      setIsSharing(false);
      if (e instanceof Error && e.name === 'AbortError') {
        alert('Share timed out — check your connection and try again.');
      } else {
        console.error('[share]', e);
        alert('Share failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  const renameProject = async (id: string, name: string) => {
    const headers = await getHeaders();
    fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name }),
    }).catch(() => {});
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, name } : p)));
    if (currentProject?.id === id) setCurrentProject(prev => (prev ? { ...prev, name } : prev));
  };

  const updateFile = (updated: FileNode) => {
    setFiles(prev => {
      const exists = prev.find(f => f.name === updated.name);
      if (exists) return prev.map(f => (f.name === updated.name ? updated : f));
      return [...prev, updated];
    });
    setActiveFile(updated);
  };

  const signOut = () => {
    isExplicitSignOut.current = true;
    void supabase.auth.signOut().catch(() => {});
    try {
      localStorage.clear();
    } catch {}
    window.location.href = '/';
  };

  // Avatar: show provider picture or initials
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const avatarInitial = (user?.email as string | undefined)?.[0]?.toUpperCase() ?? '?';

  if (!showSplash && authReady && !user) {
    return (
      <>
        <LandingPage
          onSignIn={tab => {
            setAuthTab(tab ?? 'signin');
            setShowAuth(true);
          }}
        />
        <AnimatePresence>
          {showAuth && (
            <AuthModal key="auth-modal" defaultTab={authTab} onClose={() => setShowAuth(false)} />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="app-root">
      {wallpaper && (
        <div
          className="wallpaper-bg-layer"
          style={{
            backgroundImage: `url(${wallpaper})`,
            filter: wallpaperBlur > 0 ? `blur(${wallpaperBlur * 2}px)` : undefined,
          }}
        />
      )}
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      {subscription.tier === 'pro' && <div className="pro-crown-strip" />}
      <header className="app-header">
        <div
          className={`logo${currentProject ? ' logo-home' : ''}`}
          onClick={() => currentProject && setCurrentProject(null)}
          title={currentProject ? 'Back to home' : undefined}
        >
          <LogoDisplay config={LOGO_DEFAULTS} />
          {currentProject && <span className="project-name-display">{currentProject.name}</span>}
          {subscription.tier === 'pro' && <span className="pro-chip">PRO ⬡</span>}
        </div>
        <nav className="header-nav">
          <div className="tab-switcher">
            <button
              className={`tab-btn ${activePanel === 'chat' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('chat');
                setShowSettings(false);
              }}
            >
              Chat
            </button>
            <button
              className={`tab-btn ${activePanel === 'editor' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('editor');
                setShowSettings(false);
              }}
            >
              Editor
            </button>
            <button
              className={`tab-btn ${activePanel === 'preview' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('preview');
                setShowSettings(false);
              }}
            >
              Preview
            </button>
            <button
              className={`tab-btn ${activePanel === 'video' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('video');
                setShowSettings(false);
              }}
            >
              Video
            </button>
            <button
              className={`tab-btn ${activePanel === 'studio' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('studio');
                setShowSettings(false);
              }}
            >
              Studio
            </button>
            <button
              className={`tab-btn ${activePanel === 'image' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('image');
                setShowSettings(false);
              }}
            >
              Image
            </button>
            <button
              className={`tab-btn ${activePanel === 'notes' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('notes');
                setShowSettings(false);
              }}
            >
              Notes
            </button>
            <button
              className={`tab-btn ${activePanel === '3d' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('3d');
                setShowSettings(false);
              }}
            >
              3D
            </button>
            <button
              className={`tab-btn tab-btn-debug ${activePanel === 'debug' ? 'active' : ''}`}
              onClick={() => {
                setActivePanel('debug');
                setShowSettings(false);
              }}
              title="Debug stream"
            >
              ◈
            </button>
          </div>
          <div className="header-controls">
            {currentProject && files.length > 0 && (
              <>
                <button
                  className="share-btn"
                  onClick={shareProject}
                  disabled={isSharing}
                  title="Share project"
                >
                  {isSharing ? '...' : shareUrl ? '✓ Copied!' : shareId ? '↗ Update' : '↗ Share'}
                </button>
                {shareId && (
                  <button
                    className={`gallery-publish-btn${galleryPublished ? ' published' : ''}`}
                    onClick={() => {
                      if (!galleryPublished) setShowGalleryPublish(true);
                    }}
                    title={galleryPublished ? 'Published to gallery' : 'Add to public gallery'}
                    disabled={galleryPublished}
                  >
                    {galleryPublished ? '✓ In Gallery' : '⬡ Gallery'}
                  </button>
                )}
              </>
            )}
            <button
              className={`icon-btn ${incognito ? 'incognito-active' : ''}`}
              onClick={() => {
                if (subscription.tier === 'free') {
                  setPricingReason('upgrade');
                  setShowPricing(true);
                  return;
                }
                setIncognito(s => !s);
                setIncognitoMessages([]);
                setActivePanel('chat');
              }}
              title={
                subscription.tier === 'free'
                  ? 'Incognito — Pro feature'
                  : 'Temp chat — no memory saved'
              }
            >
              ◉
            </button>
            <button
              className="feedback-header-btn"
              onClick={() => setShowFeedback(true)}
              title="Send feedback"
            >
              ⬡ Feedback
            </button>
            <a
              href="https://ko-fi.com/basedfund"
              target="_blank"
              rel="noopener noreferrer"
              className="donate-header-btn"
              title="Support Based on Ko-fi"
            >
              ◈ Support
            </a>
            <button
              className={`icon-btn ${showSettings ? 'active' : ''}`}
              onClick={() => {
                setShowSettings(s => !s);
                if (!showSettings && user && authToken) {
                  getHeaders().then(h =>
                    fetch('/api/apikey', { headers: h })
                      .then(r => r.json())
                      .then(d => setApiKeys(d.keys ?? []))
                      .catch(() => {})
                  );
                }
              }}
              title="Settings"
              aria-label="Toggle settings"
            >
              ◈
            </button>
            {user && (
              <button
                className="user-avatar-btn"
                onClick={() => setShowSettings(s => !s)}
                title={user.email}
              >
                {avatarUrl ? <img src={avatarUrl} alt="avatar" /> : avatarInitial}
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
                {user && (
                  <div className="settings-section settings-account-row">
                    <span className="settings-hint" style={{ margin: 0 }}>
                      {user.email}
                    </span>
                    <button className="auth-signout-btn" onClick={signOut}>
                      Sign Out
                    </button>
                  </div>
                )}
                <div className="settings-section">
                  <label className="settings-label">Wallpaper</label>
                  {subscription.tier === 'free' && (
                    <div
                      className="pro-gate-overlay"
                      onClick={() => {
                        setPricingReason('upgrade');
                        setShowPricing(true);
                        setShowSettings(false);
                      }}
                    >
                      <span className="pro-gate-badge">⬡ Pro</span>
                    </div>
                  )}
                  <div
                    className={`wallpaper-section${subscription.tier === 'free' ? ' pro-gate-blurred' : ''}`}
                  >
                    {wallpaper && (
                      <div
                        className="wallpaper-preview"
                        style={{ backgroundImage: `url(${wallpaper})` }}
                      />
                    )}
                    <div className="wallpaper-actions">
                      <button
                        className="wallpaper-upload-btn"
                        onClick={() => wallpaperInputRef.current?.click()}
                      >
                        {wallpaper ? 'Change Photo' : '+ Set Wallpaper'}
                      </button>
                      {wallpaper && (
                        <button className="wallpaper-clear-btn" onClick={handleWallpaperClear}>
                          Remove
                        </button>
                      )}
                    </div>
                    {wallpaper && (
                      <div className="wallpaper-blur-row">
                        <span className="wallpaper-blur-label">Blur</span>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={1}
                          value={wallpaperBlur}
                          className="wallpaper-blur-slider"
                          onChange={e => {
                            const v = Number(e.target.value);
                            setWallpaperBlur(v);
                            try {
                              localStorage.setItem('based_wallpaper_blur', String(v));
                            } catch {}
                          }}
                        />
                        <span className="wallpaper-blur-value">
                          {wallpaperBlur === 0 ? 'Off' : `${wallpaperBlur}`}
                        </span>
                      </div>
                    )}
                    <div className="settings-hint">
                      Your personal photo shows behind the UI — only visible to you.
                    </div>
                  </div>
                  <input
                    ref={wallpaperInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleWallpaperUpload}
                  />
                </div>
                <div className="settings-section" style={{ position: 'relative' }}>
                  <label className="settings-label">Appearance</label>
                  {subscription.tier === 'free' && (
                    <div
                      className="pro-gate-overlay"
                      onClick={() => {
                        setPricingReason('upgrade');
                        setShowPricing(true);
                        setShowSettings(false);
                      }}
                    >
                      <span className="pro-gate-badge">⬡ Pro</span>
                    </div>
                  )}
                  <div className={subscription.tier === 'free' ? 'pro-gate-blurred' : ''}>
                    <ThemeCustomizer
                      theme={theme}
                      onChange={async next => {
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
                </div>
                <div className="settings-section">
                  <label className="settings-label">AI Model</label>
                  <div className="model-toggle">
                    <button
                      className={`model-toggle-btn${aiModel === 'based' ? ' active' : ''}`}
                      onClick={() => setAiModel('based')}
                    >
                      <span className="model-toggle-name">Based AI</span>
                      <span className="model-toggle-sub">Claude · Best quality</span>
                    </button>
                    <button
                      className={`model-toggle-btn${aiModel === 'free' ? ' active' : ''}`}
                      onClick={() => setAiModel('free')}
                    >
                      <span className="model-toggle-name">Free AI</span>
                      <span className="model-toggle-sub">Llama · Unlimited · Unrestricted</span>
                    </button>
                  </div>
                  <div className="settings-hint">
                    Free AI uses Llama 3.3 70B — no generation limits, no content restrictions.
                  </div>
                </div>
                <div className="settings-section" style={{ position: 'relative' }}>
                  <label className="settings-label">AI Personality</label>
                  {subscription.tier === 'free' && (
                    <div
                      className="pro-gate-overlay"
                      onClick={() => {
                        setPricingReason('upgrade');
                        setShowPricing(true);
                        setShowSettings(false);
                      }}
                    >
                      <span className="pro-gate-badge">⬡ Pro</span>
                    </div>
                  )}
                  <div className={subscription.tier === 'free' ? 'pro-gate-blurred' : ''}>
                    <PersonalityPanel
                      initialSettings={personalitySettings}
                      onPersonalityChange={async (modifier, settings) => {
                        setPersonality(modifier);
                        const headers = await getHeaders();
                        fetch('/api/settings', {
                          method: 'PUT',
                          headers,
                          body: JSON.stringify({ personality: JSON.stringify(settings) }),
                        }).catch(() => {});
                      }}
                    />
                  </div>
                </div>
                <div className="settings-section" style={{ position: 'relative' }}>
                  <label className="settings-label">Global Memory</label>
                  {subscription.tier === 'free' && (
                    <div
                      className="pro-gate-overlay"
                      onClick={() => {
                        setPricingReason('upgrade');
                        setShowPricing(true);
                        setShowSettings(false);
                      }}
                    >
                      <span className="pro-gate-badge">⬡ Pro</span>
                    </div>
                  )}
                  <div className={subscription.tier === 'free' ? 'pro-gate-blurred' : ''}>
                    <div className="settings-hint" style={{ marginBottom: 8 }}>
                      Auto-updated after each conversation. Based remembers this across all
                      projects.
                    </div>
                    <div className="memory-compiled-preview">
                      {parseMemories(globalMemory).length > 0 ? (
                        parseMemories(globalMemory).map((line, i) => (
                          <div key={i} className="memory-compiled-line">
                            {i + 1}) {line}
                          </div>
                        ))
                      ) : (
                        <div className="memory-compiled-line" style={{ color: 'var(--text3)' }}>
                          No memories yet.
                        </div>
                      )}
                    </div>
                    <button
                      className="memory-manage-btn"
                      onClick={() => setShowMemoryManager(true)}
                    >
                      ⬡ Manage Memories
                    </button>
                  </div>
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
                        setProjects(prev => prev.map(p => (p.id === updated.id ? updated : p)));
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
                    <div className="settings-hint">
                      Based will remember this for every message in this project.
                    </div>
                  </div>
                )}
                {user && (
                  <div className="settings-section">
                    <label className="settings-label">Plan</label>
                    <div className="plan-badge-row">
                      <span className={`plan-badge plan-badge--${subscription.tier}`}>
                        {subscription.tier === 'pro' ? '⬡ Pro' : 'Free'}
                      </span>
                      {subscription.tier === 'free' && (
                        <span className="plan-usage">
                          {Math.min(subscription.generationsUsed, 10)}/10 generations this month
                        </span>
                      )}
                    </div>
                    {subscription.tier === 'pro' && subscription.periodStart && (
                      <div className="plan-dates">
                        <span>
                          Subscribed{' '}
                          {new Date(subscription.periodStart).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        {subscription.periodEnd && (
                          <span>
                            · Renews{' '}
                            {new Date(subscription.periodEnd).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    {subscription.tier === 'free' ? (
                      <button
                        className="plan-upgrade-btn"
                        onClick={() => {
                          setPricingReason('upgrade');
                          setShowPricing(true);
                        }}
                      >
                        Upgrade to Pro — $12/mo
                      </button>
                    ) : (
                      <button
                        className="plan-portal-btn"
                        onClick={async () => {
                          const headers = await getHeaders();
                          const res = await fetch('/api/stripe/portal', {
                            method: 'POST',
                            headers,
                          });
                          const { url } = await res.json();
                          if (url) window.location.href = url;
                        }}
                      >
                        Manage billing
                      </button>
                    )}
                    <button
                      className="plan-resync-btn"
                      onClick={async () => {
                        const headers = await getHeaders();
                        const res = await fetch('/api/stripe/sync', { method: 'POST', headers });
                        if (res.ok) {
                          const settingsRes = await fetch('/api/settings', { headers });
                          if (settingsRes.ok) {
                            const {
                              subscriptionTier,
                              subscriptionStatus,
                              generationsUsed,
                              subscriptionPeriodStart,
                              subscriptionPeriodEnd,
                            } = await settingsRes.json();
                            const tier = subscriptionTier ?? 'free';
                            setSubscription({
                              tier,
                              status: subscriptionStatus ?? 'active',
                              generationsUsed: generationsUsed ?? 0,
                              periodStart: subscriptionPeriodStart ?? null,
                              periodEnd: subscriptionPeriodEnd ?? null,
                            });
                            localStorage.setItem('based_sub_tier', tier);
                          }
                        }
                      }}
                    >
                      ↻ Re-sync subscription
                    </button>
                  </div>
                )}

                {user && (
                  <div className="settings-section">
                    <label className="settings-label">Referral</label>
                    <ReferralPanel getHeaders={getHeaders} />
                  </div>
                )}

                {user && subscription.tier === 'pro' && (
                  <div className="settings-section" style={{ position: 'relative' }}>
                    <label className="settings-label">API Keys</label>
                    <div className="apikey-section">
                      {newApiKey && (
                        <div className="apikey-reveal">
                          <span className="apikey-reveal-label">Copy now — shown once</span>
                          <div className="apikey-reveal-row">
                            <code className="apikey-code">{newApiKey}</code>
                            <button
                              className="apikey-copy-btn"
                              onClick={() => {
                                navigator.clipboard.writeText(newApiKey);
                                setNewApiKey(null);
                              }}
                            >
                              Copy &amp; Close
                            </button>
                          </div>
                        </div>
                      )}
                      {apiKeys.map(k => (
                        <div key={k.id} className="apikey-row">
                          <div className="apikey-row-meta">
                            <span className="apikey-name">{k.name}</span>
                            <span className="apikey-hint">
                              {k.calls_this_month ?? 0}/100 calls this month
                              {k.last_used_at
                                ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                                : ''}
                            </span>
                          </div>
                          <button
                            className="apikey-revoke-btn"
                            onClick={async () => {
                              const h = await getHeaders();
                              await fetch('/api/apikey', {
                                method: 'DELETE',
                                headers: h,
                                body: JSON.stringify({ id: k.id }),
                              });
                              setApiKeys(prev => prev.filter(x => x.id !== k.id));
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                      {apiKeys.length < 3 && (
                        <div className="apikey-create-row">
                          <input
                            className="apikey-name-input"
                            placeholder="Key name (e.g. My Script)"
                            value={apiKeyName}
                            onChange={e => setApiKeyName(e.target.value)}
                          />
                          <button
                            className="apikey-create-btn"
                            disabled={apiKeyLoading}
                            onClick={async () => {
                              setApiKeyLoading(true);
                              try {
                                const h = await getHeaders();
                                const res = await fetch('/api/apikey', {
                                  method: 'POST',
                                  headers: h,
                                  body: JSON.stringify({ name: apiKeyName || 'Default' }),
                                });
                                const d = await res.json();
                                if (d.key) {
                                  setNewApiKey(d.key);
                                  setApiKeyName('');
                                  const h2 = await getHeaders();
                                  fetch('/api/apikey', { headers: h2 })
                                    .then(r => r.json())
                                    .then(d2 => setApiKeys(d2.keys ?? []))
                                    .catch(() => {});
                                }
                              } finally {
                                setApiKeyLoading(false);
                              }
                            }}
                          >
                            {apiKeyLoading ? '...' : '+ Create Key'}
                          </button>
                        </div>
                      )}
                      <p className="apikey-hint-text">
                        Use your key to call <code>/api/v1/generate</code> from any script or app.
                        Max 3 keys.
                      </p>
                    </div>
                  </div>
                )}

                <div className="settings-section settings-support-card">
                  <label className="settings-label">Support Development</label>
                  <div className="support-card-body">
                    <div className="support-card-text">
                      Based is built solo by one developer. Your support funds server costs, AI
                      credits, and new features.
                    </div>
                    <a
                      href="https://ko-fi.com/basedfund"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="support-kofi-btn"
                    >
                      ◈ Support on Ko-fi
                    </a>
                  </div>
                </div>
                <div className="settings-section settings-credits">
                  <label className="settings-label">Credits</label>
                  <div className="credit-row">
                    <span className="credit-row-name">Mohamad Hus Alfyandi</span>
                    <span className="credit-row-role">Creator &amp; Lead Developer</span>
                  </div>
                  <div className="credit-row">
                    <span className="credit-row-name">Claude by Anthropic</span>
                    <span className="credit-row-role">AI Development Partner</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Creative studio panels — always accessible, no project required */}
          <div className={`panel ${activePanel === 'video' ? 'panel-active' : ''}`}>
            <VideoEditorPanel />
          </div>
          <div className={`panel ${activePanel === 'studio' ? 'panel-active' : ''}`}>
            <StudioPanel authToken={authToken} subscriptionTier={subscription.tier} />
          </div>
          <div className={`panel ${activePanel === 'image' ? 'panel-active' : ''}`}>
            <ImageStudioPanel authToken={authToken} />
          </div>
          <div className={`panel ${activePanel === 'notes' ? 'panel-active' : ''}`}>
            <NotesPanel authToken={authToken} />
          </div>
          <div className={`panel ${activePanel === '3d' ? 'panel-active' : ''}`}>
            <ThreeDStudio authToken={authToken} />
          </div>

          {activePanel !== 'video' &&
            activePanel !== 'studio' &&
            activePanel !== 'image' &&
            activePanel !== 'notes' &&
            activePanel !== '3d' &&
            (incognito ? (
              <div className="panel panel-active">
                <div className="incognito-banner">
                  ◉ Incognito Mode — chat will be wiped when you exit
                </div>
                <ChatPanel
                  messages={incognitoMessages}
                  setMessages={setIncognitoMessages}
                  files={[]}
                  onFilesUpdate={() => {}}
                  isGenerating={isGenerating}
                  setIsGenerating={setIsGenerating}
                  personality={personality}
                  memory=""
                  globalMemory={globalMemory}
                  incognito={true}
                  authToken={authToken}
                  onReportBug={() => setShowFeedback(true)}
                  aiModel={aiModel}
                />
              </div>
            ) : !currentProject ? (
              <div className="no-project">
                <div className="chat-empty-logo" aria-hidden="true">
                  B&gt;
                </div>
                <div className="no-project-title">BASED</div>
                <div className="no-project-sub">You describe it. Based builds it.</div>
                <div className="no-project-features">
                  HTML &nbsp;·&nbsp; Canvas games &nbsp;·&nbsp; Web apps &nbsp;·&nbsp; Tools
                  &nbsp;·&nbsp; Dashboards
                </div>
                <AnimatePresence>
                  {checkin && (
                    <ProactiveCheckin
                      projectName={checkin.name}
                      fromDevice={checkin.fromDevice}
                      onContinue={() => {
                        const project = projects.find(p => p.id === checkin.id);
                        if (project) loadProject(project);
                        else setCheckin(null);
                      }}
                      onDismiss={() => setCheckin(null)}
                    />
                  )}
                </AnimatePresence>
                <button className="new-project-btn-large" onClick={newProject}>
                  + New Project
                </button>
                <div className="no-project-examples">
                  {[
                    'Build a snake game',
                    'Sales dashboard with charts',
                    'Scientific calculator',
                    'Portfolio website',
                  ].map(p => (
                    <span
                      key={p}
                      onClick={() => {
                        setPendingPrompt(p);
                        newProject();
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
                <div className="no-project-hint">Sign in free · Projects save to your account</div>
              </div>
            ) : (
              <>
                <div className={`panel ${activePanel === 'chat' ? 'panel-active' : ''}`}>
                  <ChatPanel
                    messages={messages}
                    setMessages={setMessages}
                    files={files}
                    authToken={authToken}
                    subscriptionTier={subscription.tier}
                    generationsUsed={subscription.generationsUsed}
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
                    globalMemory={globalMemory}
                    incognito={incognito}
                    prefillMessage={pendingPrompt}
                    onProRequired={() => {
                      setPricingReason('upgrade');
                      setShowPricing(true);
                    }}
                    onReportBug={() => setShowFeedback(true)}
                    aiModel={aiModel}
                    onGenerationComplete={() => setActivePanel('preview')}
                    persona={persona}
                    onPersonaChange={setPersona}
                    onPanelSwitch={panel =>
                      setActivePanel(
                        panel as
                          | 'chat'
                          | 'editor'
                          | 'preview'
                          | 'debug'
                          | 'video'
                          | 'studio'
                          | 'image'
                          | 'notes'
                          | '3d'
                      )
                    }
                  />
                </div>
                <div className={`panel ${activePanel === 'editor' ? 'panel-active' : ''}`}>
                  <EditorPanel activeFile={activeFile} onFileUpdate={updateFile} />
                </div>
                <div className={`panel ${activePanel === 'preview' ? 'panel-active' : ''}`}>
                  <PreviewPanel
                    files={files}
                    projectType={projectType}
                    subscriptionTier={subscription.tier}
                    onProRequired={() => {
                      setPricingReason('upgrade');
                      setShowPricing(true);
                    }}
                  />
                </div>
                <div className={`panel ${activePanel === 'debug' ? 'panel-active' : ''}`}>
                  <DebugPanel />
                </div>
              </>
            ))}
        </main>
      </div>

      <AnimatePresence>
        {projectModal && (
          <ProjectNameModal onConfirm={createProject} onCancel={() => setProjectModal(false)} />
        )}
      </AnimatePresence>

      {showMemoryManager && (
        <MemoryManager
          memory={globalMemory}
          onSave={async mem => {
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
      <AnimatePresence>
        {showPricing && (
          <PricingModal
            reason={pricingReason}
            generationsUsed={subscription.generationsUsed}
            projectCount={projects.length}
            onClose={() => setShowPricing(false)}
            getHeaders={getHeaders}
            onSwitchToFreeAI={
              pricingReason === 'generations'
                ? () => {
                    setAiModel('free');
                    setShowPricing(false);
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFeedback && (
          <FeedbackModal userEmail={user?.email} onClose={() => setShowFeedback(false)} />
        )}
      </AnimatePresence>

      {cropperSrc && (
        <WallpaperCropper
          src={cropperSrc}
          onCrop={dataUrl => {
            setCropperSrc(null);
            saveWallpaperFromDataUrl(dataUrl);
          }}
          onSkip={() => {
            const src = cropperSrc;
            setCropperSrc(null);
            saveWallpaperFromDataUrl(src);
          }}
        />
      )}

      <AnimatePresence>
        {showGalleryPublish && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowGalleryPublish(false)}
          >
            <motion.div
              className="gallery-publish-modal"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="gpm-title">⬡ Publish to Gallery</div>
              <p className="gpm-desc">
                Your project will be visible to everyone at <strong>getbased.dev/gallery</strong>.
                Anyone can remix it.
              </p>
              <label className="gpm-label">Your display name (optional)</label>
              <input
                className="gpm-input"
                value={galleryAuthorName}
                onChange={e => setGalleryAuthorName(e.target.value)}
                placeholder={user?.email?.split('@')[0] ?? 'Anonymous'}
                maxLength={40}
              />
              <div className="gpm-actions">
                <button className="gpm-cancel" onClick={() => setShowGalleryPublish(false)}>
                  Cancel
                </button>
                <button
                  className="gpm-confirm"
                  onClick={async () => {
                    const headers = await getHeaders();
                    const res = await fetch('/api/gallery', {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({
                        shareId,
                        authorName: galleryAuthorName || user?.email?.split('@')[0] || 'Anonymous',
                      }),
                    });
                    if (res.ok) {
                      setGalleryPublished(true);
                      setShowGalleryPublish(false);
                    }
                  }}
                >
                  Publish →
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
