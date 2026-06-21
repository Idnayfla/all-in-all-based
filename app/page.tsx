'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import NextImage from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import ChatPanel from '@/components/ChatPanel';
import EditorPanel from '@/components/EditorPanel';
import PreviewPanel from '@/components/PreviewPanel';
import SidebarTrigger from '@/components/SidebarTrigger';
import DebugPanel from '@/components/DebugPanel';
import ProjectNameModal from '@/components/ProjectNameModal';
import AuthModal from '@/components/AuthModal';
import SplashScreen from '@/components/SplashScreen';
import PersonalityPanel from '@/components/PersonalityPanel';
import type { PersonaKey } from '@/components/PersonaSwitcher';
import MemoryManager, { parseMemoryItems } from '@/components/MemoryManager';
import ThemeCustomizer, {
  AppTheme,
  DEFAULT_THEME,
  applyTheme,
  loadTheme,
  saveThemeLocally,
} from '@/components/ThemeCustomizer';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { useSwipePanels } from '@/hooks/useSwipePanels';
import PricingModal from '@/components/PricingModal';
import LandingPage from '@/components/LandingPage';
import FeedbackModal from '@/components/FeedbackModal';
import ReferralPanel from '@/components/ReferralPanel';
import VideoEditorPanel from '@/components/VideoEditorPanel';
// ssr:false prevents Web Audio API code from running server-side and
// ensures the tone bundle is in its own chunk — no dynamic import() at key-press time.
const StudioPanel = dynamic(() => import('@/components/StudioPanel'), { ssr: false });
const ImageStudioPanel = dynamic(() => import('@/components/ImageStudioPanel'), { ssr: false });
const GraphPanel = dynamic(() => import('@/components/GraphPanel'), { ssr: false });
import NotesPanel from '@/components/NotesPanel';
import TasksPanel from '@/components/TasksPanel';
import EntityPanel from '@/components/EntityPanel';
import ThreeDStudio from '@/components/ThreeDStudio';
import ProactiveCheckin from '@/components/ProactiveCheckin';
import WallpaperCropper from '@/components/WallpaperCropper';
import TipsGuide from '@/components/TipsGuide';
import SpecPanel from '@/components/SpecPanel';
import { track, identifyUser } from '@/lib/posthog';
import { GetAppButton } from '@/components/GetAppButton';
import InstallPrompt from '@/components/InstallPrompt';
import { useTranslation, SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { FileNode, ContentBlock, Message, Project, contentToString } from '@/lib/types';
export type { FileNode, ContentBlock, Message, Project };

function uuid(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b]
    .map((x, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + x.toString(16).padStart(2, '0'))
    .join('');
}

// Read the Supabase access token straight out of localStorage — NO network call.
// supabase.auth.getSession() can hang indefinitely (Supabase/Electron), so the
// hot path must never depend on it. Supabase persists the session under a key
// shaped like `sb-<project-ref>-auth-token`. Recent supabase-js versions may:
//   • store plain JSON,
//   • prefix the value with `base64-` (base64-encoded JSON), and/or
//   • chunk a large session across `<key>.0`, `<key>.1`, … keys.
// This handles all three.
function getStoredAccessToken(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    const keys = Object.keys(localStorage);

    // Base storage key (non-chunked), e.g. `sb-abcd-auth-token`.
    const baseKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    let raw = baseKey ? localStorage.getItem(baseKey) : null;

    // Chunked storage: reassemble `<baseKey>.0`, `<baseKey>.1`, … in order.
    if (!raw) {
      const chunkBase = keys.find(k => /^sb-.*-auth-token\.0$/.test(k));
      if (chunkBase) {
        const prefix = chunkBase.slice(0, -2); // strip ".0"
        const chunks = keys
          .filter(k => k.startsWith(prefix + '.'))
          .sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()))
          .map(k => localStorage.getItem(k) ?? '');
        raw = chunks.join('');
      }
    }

    if (!raw) return '';

    // Decode the `base64-` envelope used by newer supabase-js versions.
    if (raw.startsWith('base64-')) {
      raw = atob(raw.slice('base64-'.length));
    }

    const parsed = JSON.parse(raw);
    // Token may live at the top level, under `currentSession`, or `session`.
    return (
      parsed?.access_token ??
      parsed?.currentSession?.access_token ??
      parsed?.session?.access_token ??
      ''
    );
  } catch {
    return '';
  }
}

const DEFAULT_PERSONALITY =
  'You are Based, the AI inside All in All Based — a sharp, witty, and direct coding assistant. You are confident, occasionally funny, and always helpful. You treat the user like a smart friend, not a customer. You get straight to the point, never over-explain, and celebrate when things work.';

export default function Home() {
  const { t, locale, setLocale } = useTranslation();
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
    | 'chat'
    | 'build'
    | 'editor'
    | 'preview'
    | 'debug'
    | 'video'
    | 'studio'
    | 'image'
    | 'notes'
    | '3d'
    | 'spec'
    | 'tasks'
    | 'brain'
    | 'graph'
  >('chat');
  const [lastBuildActivity, setLastBuildActivity] = useState<{
    name: string;
    timestamp: number;
  } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  useSwipePanels(activePanel, setActivePanel, !incognito && !!currentProject);
  const [projectModal, setProjectModal] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareId, setShareId] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [showStudioMenu, setShowStudioMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const studioMenuRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
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
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string>('');
  const isExplicitSignOut = useRef(false);
  const currentProjectRef = useRef<Project | null>(null);
  useEffect(() => {
    currentProjectRef.current = currentProject;
  }, [currentProject]);

  // Share state is per-project. Whenever the active project changes, reset it so
  // the publish/share button never inherits another project's "Update" state.
  const sharedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (sharedProjectIdRef.current !== (currentProject?.id ?? null)) {
      sharedProjectIdRef.current = currentProject?.id ?? null;
      setShareUrl('');
      setShareId('');
      setGalleryPublished(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    track('panel_switched', { panel: activePanel });
  }, [activePanel]);

  // Close group dropdowns when clicking outside them. Each wrapper has its own
  // ref so clicking the Studio button never closes the Tools menu (and vice
  // versa), and clicking inside a menu's own wrapper keeps it open.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (studioMenuRef.current && !studioMenuRef.current.contains(target)) {
        setShowStudioMenu(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(target)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const LATEST_CHANGELOG = '2026-06-02';
  useEffect(() => {
    try {
      const seen = localStorage.getItem('based_changelog_seen');
      setHasNewChangelog(!seen || seen < LATEST_CHANGELOG);
    } catch {}
  }, []);
  const [showSplash, setShowSplash] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [createError] = useState<string | null>(null);
  // Seed subscription tier from localStorage so Pro users see Pro immediately on
  // refresh, before the async /api/settings call resolves. This prevents the race
  // where auth-session hydration is slow and the fetch fires with an empty token,
  // gets a 401, and leaves the user stuck on Free for the whole session.
  const cachedSubTier = (() => {
    try {
      const v = localStorage.getItem('based_sub_tier');
      return v === 'pro' || v === 'beta' || v === 'free' ? v : 'free';
    } catch {
      return 'free' as const;
    }
  })();
  const [subscription, setSubscription] = useState<{
    tier: 'free' | 'beta' | 'pro';
    status: string;
    generationsUsed: number;
    betaDaysLeft: number;
    periodStart: string | null;
    periodEnd: string | null;
  }>({
    tier: cachedSubTier,
    status: 'active',
    generationsUsed: 0,
    betaDaysLeft: 0,
    periodStart: null,
    periodEnd: null,
  });
  const [showPricing, setShowPricing] = useState(false);
  const [pricingReason, setPricingReason] = useState<
    'generations' | 'projects' | 'upgrade' | 'companion'
  >('upgrade');
  const [showFeedback, setShowFeedback] = useState(false);
  const [hasNewChangelog, setHasNewChangelog] = useState(false);
  const [showProWelcome, setShowProWelcome] = useState(false);
  const [syncingSubscription, setSyncingSubscription] = useState(false);
  const [syncLabel, setSyncLabel] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle');
  const [checkin, setCheckin] = useState<{
    id: string;
    name: string;
    fromDevice?: 'mobile' | 'tablet' | 'desktop';
    error?: string;
  } | null>(null);
  const [dueBanner, setDueBanner] = useState<{ count: number; firstTitle: string } | null>(null);
  const [aiModel, setAiModelState] = useState<'based' | 'free'>('based');
  const persona: PersonaKey = 'based';
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
  const [chatInputTrigger, setChatInputTrigger] = useState(0);

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
  }, []);

  // ── Restore AI model preference ──────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('based_ai_model');
    if (saved === 'free' || saved === 'based') setAiModelState(saved);
  }, []);

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
  }, []);

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
      fetch(`/api/gallery/remix/${remixShareId}`, { method: 'POST', headers }).catch(() => {});
      const id = uuid();
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
  }, []);

  // ── Handle return from Stripe checkout ──────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      (window as Window & { fbq?: (...args: unknown[]) => void }).fbq?.('track', 'Purchase', {
        value: 12.0,
        currency: 'SGD',
      });
      window.history.replaceState({}, '', window.location.pathname);
      setSubscription(s => ({ ...s, tier: 'pro' }));
      setShowProWelcome(true);
    }
  }, []);

  // ── Suppress unhandled AbortError rejections from Turbopack HMR ────────────
  // Turbopack aborts its own internal chunk fetches during HMR and surfaces them
  // as "Runtime AbortError" in the dev overlay. These are harmless noise — the
  // browser retries automatically. We suppress them here so the overlay never fires.
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof Error && e.reason.name === 'AbortError') e.preventDefault();
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
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
  }, []);

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
  }, [user, authReady, currentProject]);

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
  }, []);

  // ── Auth headers helper ──────────────────────────────────────────────────
  // Read the token from localStorage directly. getSession() can hang forever
  // (Supabase/Electron), which previously blocked every authed request. The
  // cached authToken state is preferred; localStorage is the no-network fallback.
  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = authToken || getStoredAccessToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, [authToken]);

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
  }, [user, currentProject, getHeaders]);

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
      const rawList: Project[] = projects ?? [];
      // Guard: if the active project has messages not yet flushed to the server
      // (auto-save is fire-and-forget), keep the in-memory version so a focus
      // event can't clobber unsaved history.
      const currentP = currentProjectRef.current;
      const list = currentP
        ? rawList.map(p =>
            p.id === currentP.id && currentP.messages.length > p.messages.length
              ? { ...p, messages: currentP.messages, files: currentP.files }
              : p
          )
        : rawList;
      setProjects(list);
      saveProjectsCache(list);
    } else {
      console.warn(
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
        betaDaysLeft,
        subscriptionPeriodStart,
        subscriptionPeriodEnd,
      } = await settingsRes.json();
      const tier = subscriptionTier ?? 'free';
      setSubscription({
        tier,
        status: subscriptionStatus ?? 'active',
        generationsUsed: generationsUsed ?? 0,
        betaDaysLeft: betaDaysLeft ?? 0,
        periodStart: subscriptionPeriodStart ?? null,
        periodEnd: subscriptionPeriodEnd ?? null,
      });
      // Persist confirmed tier so the next refresh can seed from it optimistically
      try {
        localStorage.setItem('based_sub_tier', tier);
      } catch {}

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
        // Local theme wins — only apply cloud theme on first load (no local save yet)
        if (!localStorage.getItem('based_theme')) {
          setTheme(merged);
          applyTheme(merged);
          saveThemeLocally(merged);
        }
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
    // getSession() can hang forever (Supabase/Electron). Race it against a 3s
    // timeout; if it loses, fall back to reading the token straight from
    // localStorage so the app stays usable (token works even without user info).
    const SESSION_TIMEOUT = 3000;
    (async () => {
      type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
      const timeoutResult: SessionResult = {
        data: { session: null },
        error: null,
      };
      const {
        data: { session },
        error,
      } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<SessionResult>(resolve =>
          setTimeout(() => resolve(timeoutResult), SESSION_TIMEOUT)
        ),
      ]);

      if (error) {
        // Stale or invalid refresh token — clear it so the auth modal shows cleanly
        await supabase.auth.signOut();
        setAuthReady(true);
        return;
      }

      if (!session) {
        // getSession() timed out or returned no session. Try localStorage so a
        // logged-in user can still make authed requests even if getSession hangs.
        const storedToken = getStoredAccessToken();
        if (storedToken) {
          setAuthToken(storedToken);
          // A bare token gives us auth headers but NOT the user object — without
          // setUser()+loadCloudData() the account looks empty after login.
          // getUser(token) is a separate network call that doesn't hang the same
          // way getSession does, but race it against a short timeout to be safe.
          try {
            type SupabaseUser = Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'];
            const tokenUser = await Promise.race([
              supabase.auth.getUser(storedToken).then(r => r.data.user),
              new Promise<SupabaseUser>(resolve => setTimeout(() => resolve(null), 3000)),
            ]);
            if (tokenUser) {
              setUser(tokenUser);
              setAuthReady(true);
              await loadCloudData();
              return;
            }
          } catch {
            // fall through — onAuthStateChange will backfill if it resolves later
          }
        }
        // user info is unavailable from a bare token; onAuthStateChange will
        // backfill it if/when getSession eventually resolves.
        setAuthReady(true);
        return;
      }

      const currentUser = session.user ?? null;
      setUser(currentUser);
      setAuthToken(session.access_token ?? '');
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
    })().catch(() => {});

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
        // Always clear the stale tier cache so a different account signing in
        // next doesn't inherit the previous account's Pro status.
        try {
          localStorage.removeItem('based_sub_tier');
        } catch {}
        setSubscription({
          tier: 'free',
          status: 'active',
          generationsUsed: 0,
          betaDaysLeft: 0,
          periodStart: null,
          periodEnd: null,
        });

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
  }, [getHeaders, handleRemix, loadCloudData, runMigration]);

  // ── Fire entrance ripple on login (user falsy → truthy, no route change) ──
  const prevUserRef = useRef<User | null | undefined>(undefined);
  useEffect(() => {
    if (prevUserRef.current === undefined) {
      prevUserRef.current = user;
      return; // skip mount
    }
    if (!prevUserRef.current && user) {
      // user just logged in — fire entrance ripple
      const el = document.createElement('div');
      el.className = 'landing-entrance-ripple';
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
    prevUserRef.current = user;
  }, [user]);

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

  // ── Due-task banner: show once per session when tasks are due today ───────
  useEffect(() => {
    if (!user || !authToken) return;
    // Only show once per browser session
    try {
      if (sessionStorage.getItem('based_due_banner_dismissed')) return;
    } catch {}
    (async () => {
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/tasks?due_today=true', { headers });
        if (!res.ok) return;
        const data = await res.json();
        const tasks: Array<{ title: string; status: string }> = Array.isArray(data) ? data : [];
        const active = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
        if (active.length > 0) {
          setDueBanner({ count: active.length, firstTitle: active[0].title });
        }
      } catch {}
    })();
  }, [user, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Detect intermediate in-progress message content (never persist these) ─
  function isInProgressContent(content: Message['content']): boolean {
    if (typeof content !== 'string') return false;
    return (
      content === '... Working' ||
      content === '◈ Working...' ||
      content === '◈ Planning...' ||
      content.startsWith('◈ Searching') ||
      content.startsWith('◈ Checking') ||
      content.startsWith('◈ Retrying') ||
      content.startsWith('⟳ Building')
    );
  }

  // ── Auto-save project on files/messages change ───────────────────────────
  useEffect(() => {
    if (!currentProject || !user) return;
    if (files.length === 0 && messages.length === 0) return;
    // Never overwrite persisted files with an empty array — guards against timing edge cases
    if (files.length === 0 && (currentProject.files?.length ?? 0) > 0) return;
    // Drop the last message if it's still in-progress streaming state — never persist "Working"
    const msgsToSave =
      messages.length > 0 &&
      messages[messages.length - 1].role === 'assistant' &&
      isInProgressContent(messages[messages.length - 1].content)
        ? messages.slice(0, -1)
        : messages;
    const strippedMessages = msgsToSave.map(m => ({
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
    // Beta deployments are always treated as Pro — ALWAYS_PRO=true (or BETA_ACCESS_CODE set)
    // on the server mirrors this on every gated API, so the client-side 3-project limit must
    // also be lifted for beta users to avoid a mismatched gate.
    // Use NEXT_PUBLIC_BUILD_ENV when set; fall back to hostname detection so the gate
    // is skipped even if the env var is missing from the Vercel beta project settings.
    const isBetaEnv =
      process.env.NEXT_PUBLIC_BUILD_ENV === 'beta' ||
      (typeof window !== 'undefined' && window.location.hostname === 'beta.getbased.dev');
    if (!isBetaEnv && subscription.tier === 'free' && projects.length >= 3) {
      setPricingReason('projects');
      setShowPricing(true);
      return;
    }
    setProjectModal(true);
  };

  const quickProject = (prompt: string) => {
    const isBetaEnv =
      process.env.NEXT_PUBLIC_BUILD_ENV === 'beta' ||
      (typeof window !== 'undefined' && window.location.hostname === 'beta.getbased.dev');
    if (!isBetaEnv && subscription.tier === 'free' && projects.length >= 3) {
      setPricingReason('projects');
      setShowPricing(true);
      return;
    }
    const name = prompt.trim().split(/\s+/).slice(0, 5).join(' ');
    setPendingPrompt(prompt);
    createProject(name);
  };

  const startChat = () => {
    const isBetaEnv =
      process.env.NEXT_PUBLIC_BUILD_ENV === 'beta' ||
      (typeof window !== 'undefined' && window.location.hostname === 'beta.getbased.dev');
    const needsNewProject = !currentProject && !incognito;
    // Projects gate only applies when we actually need to create a new project
    if (needsNewProject && !isBetaEnv && subscription.tier === 'free' && projects.length >= 3) {
      setPricingReason('projects');
      setShowPricing(true);
      return;
    }
    if (needsNewProject) {
      createProject('New chat');
    }
    setChatInputTrigger(t => t + 1);
  };

  const handleAutoName = async (projectId: string, firstPrompt: string) => {
    try {
      const res = await fetch('/api/autoname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: firstPrompt }),
      });
      if (!res.ok) return;
      const { name } = await res.json();
      if (name) renameProject(projectId, name);
    } catch {}
  };

  const createProject = async (name: string) => {
    setProjectModal(false);

    // Generate ID on client so local and cloud share the same ID from the start
    const id = uuid();
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
    setShareId('');
    setGalleryPublished(false);

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
    // Sanitize: drop any stale in-progress message that was persisted before a crash/reload
    const sanitizedMessages =
      project.messages.length > 0 &&
      project.messages[project.messages.length - 1].role === 'assistant' &&
      isInProgressContent(project.messages[project.messages.length - 1].content)
        ? project.messages.slice(0, -1)
        : project.messages;
    setCurrentProject({ ...project, messages: sanitizedMessages });
    setFiles(project.files);
    setMessages(sanitizedMessages);
    setActiveFile(project.files[0] ?? null);
    setActivePanel('chat');
    setShareUrl('');
    setShareId('');
    setGalleryPublished(false);
    setCheckin(null);

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
    // Only aborts the fetch — we never block on getSession() anymore.
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      // Use the cached session token first; otherwise read it straight from
      // localStorage. NEVER call getSession() here — it can hang indefinitely
      // (Supabase/Electron), which is exactly what made Share time out.
      const token = authToken || getStoredAccessToken();
      const res = await fetch('/api/share', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          files,
          projectName: currentProject.name,
          projectId: currentProject.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        const full = `https://getbased.dev${data.url}`;
        setShareUrl(full);
        setShareId(data.id ?? '');
        setGalleryPublished(false);
        if (navigator.share) {
          navigator.share({ title: currentProject.name, url: full }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(full).catch(() => {});
        }
      } else if (res.status === 401) {
        console.error('[share] 401 unauthorized');
        alert('Your session expired — please log in again and retry.');
      } else {
        console.error('[share]', data.error ?? res.status);
        alert('Share failed: ' + (data.error ?? `HTTP ${res.status}`));
      }
    } catch (e: unknown) {
      console.error('[share]', e);
      if (e instanceof Error && e.name === 'AbortError') {
        alert('Share timed out — check your connection and try again.');
      } else {
        alert('Share failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      clearTimeout(timeout);
      setIsSharing(false); // ALWAYS reset, success or failure
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
          onClick={() => {
            if (incognito) return;
            if (currentProject) {
              setCurrentProject(null);
            } else {
              startChat();
            }
          }}
          title={currentProject ? 'Back to home' : 'Ask Based anything'}
        >
          <span className="brand-logo-wrap">
            <NextImage
              src="/brand-icon-loop.svg"
              className="brand-logo-icon"
              alt="Based"
              width={36}
              height={36}
            />
            <span className="brand-logo-text">BASED</span>
          </span>
          {currentProject && <span className="project-name-display">{currentProject.name}</span>}
          {subscription.tier === 'pro' && <span className="pro-chip">PRO ⬡</span>}
          <span className="early-access-chip">◈ Early Access</span>
        </div>
        <nav className="header-nav">
          {/* tab-switcher relocated to its own dedicated row below the header (see .tab-bar-row) */}
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
              {incognito ? '⊙ Incognito' : '⊙'}
            </button>
            <GetAppButton className="companion-header-btn" />
            {user && subscription.tier !== 'pro' && (
              <button
                className={`gen-counter-badge${subscription.generationsUsed >= (subscription.tier === 'beta' ? 27 : 9) ? ' gen-counter--danger' : subscription.generationsUsed >= (subscription.tier === 'beta' ? 24 : 7) ? ' gen-counter--warn' : ''}${subscription.tier === 'beta' ? ' gen-counter--beta' : ''}`}
                title={`${subscription.generationsUsed} of ${subscription.tier === 'beta' ? 30 : 10} generations used this month`}
                onClick={() => {
                  setPricingReason('upgrade');
                  setShowPricing(true);
                }}
              >
                {Math.min(subscription.generationsUsed, subscription.tier === 'beta' ? 30 : 10)}/
                {subscription.tier === 'beta' ? 30 : 10}
              </button>
            )}
            <Link
              href="/group"
              className="companion-header-btn"
              title="Start or join a group chat"
              style={{ textDecoration: 'none' }}
            >
              ⬡ Group
            </Link>
            <a
              href="/vote"
              target="_blank"
              rel="noopener noreferrer"
              className="companion-header-btn"
              title="Vote on what gets built next"
              style={{ textDecoration: 'none' }}
            >
              ⬡ Vote
            </a>
            {subscription.tier !== 'pro' ? (
              <button
                className="header-upgrade-btn"
                onClick={() => {
                  setPricingReason('upgrade');
                  setShowPricing(true);
                }}
                title="Upgrade to Pro"
              >
                ⬡ Go Pro
              </button>
            ) : (
              <a
                href="https://ko-fi.com/basedfund"
                target="_blank"
                rel="noopener noreferrer"
                className="donate-header-btn"
                title="Support Based on Ko-fi"
              >
                ◈ Support
              </a>
            )}
            <button
              className={`icon-btn ${showSettings ? 'active' : ''}`}
              onClick={() => {
                const closing = showSettings;
                setShowSettings(s => !s);
                if (closing) {
                  setApiKeyError(null);
                  setNewApiKey(null);
                }
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
                {avatarUrl ? (
                  <NextImage src={avatarUrl} alt="avatar" width={32} height={32} />
                ) : (
                  avatarInitial
                )}
              </button>
            )}
            <div className="header-status">
              <span className={`status-dot ${isGenerating ? 'generating' : 'ready'}`}>●</span>
              <span className="status-text">{isGenerating ? 'Generating...' : 'Ready'}</span>
            </div>
          </div>
        </nav>
      </header>

      {/* Tab bar — its own dedicated row below the header (never shares a row with header buttons) */}
      <div className="tab-bar-row">
        <div className="tab-switcher">
          {/* Chat — companion only, never generates code */}
          <button
            className={`tab-btn ${activePanel === 'chat' ? 'active' : ''}`}
            onClick={() => {
              if (activePanel === 'build' && currentProject) {
                setLastBuildActivity({ name: currentProject.name, timestamp: Date.now() });
              }
              setActivePanel('chat');
              setShowSettings(false);
              setShowStudioMenu(false);
              setShowToolsMenu(false);
            }}
          >
            Chat
          </button>
          {/* Build — app generation, live preview */}
          <button
            className={`tab-btn ${activePanel === 'build' ? 'active' : ''}`}
            onClick={() => {
              setActivePanel('build');
              setShowSettings(false);
              setShowStudioMenu(false);
              setShowToolsMenu(false);
            }}
          >
            Build
          </button>
          {/* Preview — always visible */}
          <button
            className={`tab-btn ${activePanel === 'preview' ? 'active' : ''}`}
            onClick={() => {
              setActivePanel('preview');
              setShowSettings(false);
              setShowStudioMenu(false);
              setShowToolsMenu(false);
            }}
          >
            Preview
          </button>
          {/* Studio group: Video · Music · Image · 3D · Code (Editor) */}
          {(() => {
            const STUDIO_PANELS = ['video', 'studio', 'image', '3d', 'editor'] as const;
            const studioActive = (STUDIO_PANELS as readonly string[]).includes(activePanel);
            const activeLabel = studioActive
              ? ((
                  {
                    video: 'Video',
                    studio: 'Music',
                    image: 'Image',
                    '3d': '3D',
                    editor: 'Code',
                  } as Record<string, string>
                )[activePanel] ?? 'Studio')
              : 'Studio';
            return (
              <div className="tab-group-wrap" ref={studioMenuRef}>
                <button
                  className={`tab-btn${studioActive ? ' active' : ''}`}
                  onClick={() => {
                    setShowStudioMenu(s => !s);
                    setShowToolsMenu(false);
                    setShowSettings(false);
                  }}
                >
                  {activeLabel} ▾
                </button>
                {showStudioMenu && (
                  <div className="tab-group-menu">
                    {(
                      [
                        { id: 'video', label: 'Video' },
                        { id: 'studio', label: 'Music' },
                        { id: 'image', label: 'Image' },
                        { id: '3d', label: '3D' },
                        { id: 'editor', label: 'Code' },
                      ] as const
                    ).map(item => (
                      <button
                        key={item.id}
                        className={`tab-group-item${activePanel === item.id ? ' active' : ''}`}
                        onClick={() => {
                          setActivePanel(item.id);
                          setShowStudioMenu(false);
                          setShowSettings(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Tools group: Notes · Tasks · Brain */}
          {(() => {
            const TOOLS_PANELS = ['notes', 'tasks', 'brain', 'graph'] as const;
            const toolsActive = (TOOLS_PANELS as readonly string[]).includes(activePanel);
            const activeLabel = toolsActive
              ? ((
                  {
                    notes: 'Notes',
                    tasks: 'Tasks',
                    brain: 'Brain',
                    graph: 'Graph',
                  } as Record<string, string>
                )[activePanel] ?? 'Tools')
              : 'Tools';
            return (
              <div className="tab-group-wrap" ref={toolsMenuRef}>
                <button
                  className={`tab-btn${toolsActive ? ' active' : ''}`}
                  onClick={() => {
                    setShowToolsMenu(s => !s);
                    setShowStudioMenu(false);
                    setShowSettings(false);
                  }}
                >
                  {activeLabel} ▾
                </button>
                {showToolsMenu && (
                  <div className="tab-group-menu">
                    {(
                      [
                        { id: 'notes', label: 'Notes' },
                        { id: 'tasks', label: 'Tasks' },
                        { id: 'brain', label: 'Brain' },
                        { id: 'graph', label: 'Graph' },
                      ] as const
                    ).map(item => (
                      <button
                        key={item.id}
                        className={`tab-group-item${activePanel === item.id ? ' active' : ''}`}
                        onClick={() => {
                          setActivePanel(item.id);
                          setShowToolsMenu(false);
                          setShowSettings(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {incognito && (
        <div className="incognito-banner">⊙ Incognito — no memory saved this session</div>
      )}

      {/* Due-task banner — shown once per session when tasks are due today */}
      {dueBanner && (
        <div className="due-task-banner">
          <span className="due-task-banner-text">
            ◈ You have {dueBanner.count} task{dueBanner.count !== 1 ? 's' : ''} due today —{' '}
            {dueBanner.firstTitle}
          </span>
          <button
            className="due-task-banner-view"
            onClick={() => {
              setActivePanel('tasks');
              setDueBanner(null);
              try {
                sessionStorage.setItem('based_due_banner_dismissed', '1');
              } catch {}
            }}
          >
            View Tasks
          </button>
          <button
            className="due-task-banner-close"
            onClick={() => {
              setDueBanner(null);
              try {
                sessionStorage.setItem('based_due_banner_dismissed', '1');
              } catch {}
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Tips guide for new users */}
      <TipsGuide />
      <InstallPrompt />

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
                  <>
                    <div className="settings-section settings-account-row">
                      <span className="settings-hint settings-hint--flush">{user.email}</span>
                      <button className="auth-signout-btn" onClick={signOut}>
                        Sign Out
                      </button>
                    </div>
                    <div className="settings-section">
                      <label className="settings-label">Invite a Friend</label>
                      <div className="settings-hint" style={{ marginBottom: 8 }}>
                        Share Based with someone who&apos;d love it.
                      </div>
                      <button
                        disabled
                        title="Referral tracking coming soon"
                        style={{ opacity: 0.4, cursor: 'not-allowed' }}
                        className="auth-signout-btn"
                      >
                        ⬡ Invite — coming soon
                      </button>
                    </div>
                  </>
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
                <div className="settings-section settings-section--relative">
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
                <div className="settings-section settings-section--relative">
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
                <div className="settings-section settings-section--relative">
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
                    <div className="settings-hint settings-hint--spaced">
                      Auto-updated after each conversation. Based remembers this across all
                      projects.
                    </div>
                    <div className="memory-compiled-preview">
                      {parseMemoryItems(globalMemory).length > 0 ? (
                        parseMemoryItems(globalMemory).map((item, i) => (
                          <div key={i} className="memory-compiled-line">
                            {i + 1}) {item.text}
                            {item.source && (
                              <span className="memory-source-tag">· {item.source}</span>
                            )}
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
                        {subscription.tier === 'pro'
                          ? '⬡ Pro'
                          : subscription.tier === 'beta'
                            ? '◈ Beta'
                            : 'Free'}
                      </span>
                      {subscription.tier !== 'pro' && (
                        <span className="plan-usage">
                          {Math.min(
                            subscription.generationsUsed,
                            subscription.tier === 'beta' ? 30 : 10
                          )}
                          /{subscription.tier === 'beta' ? 30 : 10} generations this month
                        </span>
                      )}
                    </div>
                    {subscription.tier === 'beta' && subscription.betaDaysLeft > 0 && (
                      <div className="plan-beta-expiry">
                        ◈ Beta access expires in {subscription.betaDaysLeft} day
                        {subscription.betaDaysLeft !== 1 ? 's' : ''}
                      </div>
                    )}
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
                    {subscription.tier !== 'pro' ? (
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
                      disabled={syncingSubscription}
                      onClick={async () => {
                        setSyncingSubscription(true);
                        setSyncLabel('syncing');
                        try {
                          const headers = await getHeaders();
                          const res = await fetch('/api/stripe/sync', { method: 'POST', headers });
                          if (res.ok) {
                            const settingsRes = await fetch('/api/settings', { headers });
                            if (settingsRes.ok) {
                              const {
                                subscriptionTier,
                                subscriptionStatus,
                                generationsUsed,
                                betaDaysLeft: bDays,
                                subscriptionPeriodStart,
                                subscriptionPeriodEnd,
                              } = await settingsRes.json();
                              const tier = subscriptionTier ?? 'free';
                              setSubscription({
                                tier,
                                status: subscriptionStatus ?? 'active',
                                generationsUsed: generationsUsed ?? 0,
                                betaDaysLeft: bDays ?? 0,
                                periodStart: subscriptionPeriodStart ?? null,
                                periodEnd: subscriptionPeriodEnd ?? null,
                              });
                              try {
                                localStorage.setItem('based_sub_tier', tier);
                              } catch {}
                              setSyncLabel('synced');
                              setTimeout(() => setSyncLabel('idle'), 2000);
                            } else {
                              setSyncLabel('failed');
                              setTimeout(() => setSyncLabel('idle'), 3000);
                            }
                          } else {
                            setSyncLabel('failed');
                            setTimeout(() => setSyncLabel('idle'), 3000);
                          }
                        } catch {
                          setSyncLabel('failed');
                          setTimeout(() => setSyncLabel('idle'), 3000);
                        } finally {
                          setSyncingSubscription(false);
                        }
                      }}
                    >
                      {syncLabel === 'syncing'
                        ? 'Syncing…'
                        : syncLabel === 'synced'
                          ? 'Synced ✓'
                          : syncLabel === 'failed'
                            ? 'Failed — try again'
                            : '↻ Re-sync subscription'}
                    </button>
                    <div className="settings-hint early-access-note">
                      ◈ Based is in Early Access — rough edges are expected. Your feedback shapes
                      what ships next.
                    </div>
                  </div>
                )}

                {user && (
                  <div className="settings-section">
                    <label className="settings-label">Referral</label>
                    <ReferralPanel getHeaders={getHeaders} />
                  </div>
                )}

                <div className="settings-section">
                  <label className="settings-label">{t('settings.language')}</label>
                  <div className="lang-switcher">
                    {SUPPORTED_LANGUAGES.map(lang => (
                      <button
                        key={lang.code}
                        className={`lang-btn${locale === lang.code ? ' active' : ''}`}
                        onClick={() => setLocale(lang.code)}
                      >
                        {lang.nativeLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {user && subscription.tier === 'pro' && (
                  <div className="settings-section settings-section--relative">
                    <label className="settings-label">API Keys</label>
                    <div className="pantheon-onboarding-card">
                      <span className="pantheon-onboarding-title">Pantheon VSCode Extension</span>
                      <ol className="pantheon-onboarding-steps">
                        <li>
                          Install the extension from the{' '}
                          <a
                            href="https://marketplace.visualstudio.com/items?itemName=Idnayfla.pantheon"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pantheon-onboarding-link"
                          >
                            VS Code Marketplace
                          </a>
                        </li>
                        <li>
                          Generate a key below — name it{' '}
                          <code className="pantheon-onboarding-code">VSCode</code> or anything you
                          like
                        </li>
                        <li>
                          Paste it into extension settings under{' '}
                          <code className="pantheon-onboarding-code">pantheon.apiKey</code>
                        </li>
                      </ol>
                    </div>
                    <p className="apikey-migration-notice">
                      Keys generated before 21 May 2026 used an old format and will not work. Revoke
                      them and generate a new one.
                    </p>
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
                              setApiKeyError(null);
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
                                } else {
                                  setApiKeyError(
                                    d.error ?? 'Failed to generate key. Please try again.'
                                  );
                                }
                              } catch {
                                setApiKeyError(
                                  'Network error. Please check your connection and try again.'
                                );
                              } finally {
                                setApiKeyLoading(false);
                              }
                            }}
                          >
                            {apiKeyLoading ? '...' : '+ Create Key'}
                          </button>
                        </div>
                      )}
                      {apiKeyError && <p className="apikey-error-text">{apiKeyError}</p>}
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
                <div className="settings-section">
                  <div className="settings-label">Links</div>
                  <a
                    href="/vote"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link-row"
                  >
                    ⬡ Vote on features
                  </a>
                  <a
                    href="/changelog"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link-row"
                    onClick={() => {
                      try {
                        localStorage.setItem('based_changelog_seen', LATEST_CHANGELOG);
                        setHasNewChangelog(false);
                      } catch {}
                    }}
                  >
                    {hasNewChangelog ? "◈ What's New ●" : "◈ What's New"}
                  </a>
                  <button
                    className="settings-link-row"
                    onClick={() => {
                      setShowFeedback(true);
                      setShowSettings(false);
                    }}
                  >
                    ⬡ Send Feedback
                  </button>
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
            <VideoEditorPanel authToken={authToken} />
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
          <div className={`panel ${activePanel === 'tasks' ? 'panel-active' : ''}`}>
            <TasksPanel authToken={authToken} />
          </div>
          <div className={`panel ${activePanel === 'brain' ? 'panel-active' : ''}`}>
            <EntityPanel authToken={authToken} />
          </div>
          <div className={`panel ${activePanel === 'graph' ? 'panel-active' : ''}`}>
            <GraphPanel
              authToken={authToken}
              onOpenProject={projectId => {
                const p = projects.find(pr => pr.id === projectId);
                if (p) setCurrentProject(p);
                setActivePanel('chat');
              }}
              onAskAbout={label => {
                setPendingPrompt(`Tell me about ${label}`);
                setActivePanel('chat');
              }}
            />
          </div>
          <div className={`panel ${activePanel === '3d' ? 'panel-active' : ''}`}>
            <ThreeDStudio />
          </div>
          <div className={`panel ${activePanel === 'spec' ? 'panel-active' : ''}`}>
            <SpecPanel
              authToken={authToken}
              currentProject={currentProject}
              subscriptionTier={subscription.tier}
              onBuildFromSpec={prompt => {
                setPendingPrompt(prompt);
                setActivePanel('chat');
              }}
            />
          </div>

          {activePanel !== 'video' &&
            activePanel !== 'studio' &&
            activePanel !== 'image' &&
            activePanel !== 'notes' &&
            activePanel !== '3d' &&
            activePanel !== 'spec' &&
            activePanel !== 'tasks' &&
            activePanel !== 'brain' &&
            activePanel !== 'graph' &&
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
                <div className="no-project-tap-hint">Tap me to start chatting.</div>
                <button
                  className="chat-empty-logo-btn"
                  onClick={startChat}
                  aria-label="Start chatting"
                >
                  <NextImage
                    src="/brand-icon-loop.svg"
                    className="chat-empty-logo"
                    alt="Based"
                    width={80}
                    height={80}
                  />
                </button>
                <div className="no-project-title">BASED</div>
                <AnimatePresence>
                  {checkin && (
                    <ProactiveCheckin
                      projectName={checkin.name}
                      fromDevice={checkin.fromDevice}
                      error={checkin.error}
                      onContinue={async () => {
                        const inState = projects.find(p => p.id === checkin.id);
                        if (inState) {
                          loadProject(inState);
                          return;
                        }
                        const cached = loadProjectsCache().find(p => p.id === checkin.id);
                        if (cached) {
                          loadProject(cached);
                          return;
                        }
                        try {
                          const headers = await getHeaders();
                          const res = await fetch(`/api/projects/${checkin.id}`, { headers });
                          if (res.ok) {
                            const { project } = await res.json();
                            if (project) {
                              loadProject(project);
                              return;
                            }
                          }
                        } catch {}
                        setCheckin(prev =>
                          prev ? { ...prev, error: 'That project was deleted.' } : null
                        );
                      }}
                      onDismiss={() => setCheckin(null)}
                    />
                  )}
                </AnimatePresence>
                <div className="no-project-hint">Sign in free · Projects save to your account</div>
                <div className="memory-pitch">
                  <span className="memory-pitch-icon">◉</span>
                  Based learns from you — smarter every project
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`panel ${activePanel === 'chat' || activePanel === 'build' ? 'panel-active' : ''}`}
                >
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
                    tabMode={activePanel === 'chat' ? 'chat' : 'build'}
                    lastBuildProject={lastBuildActivity}
                    onPanelSwitch={panel => {
                      if (panel === 'build' && activePanel === 'chat' && currentProject) {
                        setLastBuildActivity({ name: currentProject.name, timestamp: Date.now() });
                      }
                      setActivePanel(
                        panel as
                          | 'chat'
                          | 'build'
                          | 'editor'
                          | 'preview'
                          | 'debug'
                          | 'video'
                          | 'studio'
                          | 'image'
                          | 'notes'
                          | '3d'
                          | 'spec'
                          | 'tasks'
                          | 'brain'
                          | 'graph'
                      );
                    }}
                    onAutoName={
                      currentProject
                        ? (prompt: string) => handleAutoName(currentProject.id, prompt)
                        : undefined
                    }
                    onLogoClick={startChat}
                    openInputTrigger={chatInputTrigger}
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
              subscription.generationsUsed >= 10
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
          <FeedbackModal
            userEmail={user?.email}
            onClose={() => setShowFeedback(false)}
            conversationContext={(() => {
              const activeMessages = incognito ? incognitoMessages : messages;
              const last = activeMessages.slice(-4);
              if (last.length === 0) return undefined;
              const lines = [`--- Conversation Snapshot (last ${last.length} messages) ---`];
              last.forEach(m => {
                lines.push('');
                lines.push(m.role === 'user' ? 'USER:' : 'BASED:');
                lines.push(contentToString(m.content));
              });
              return lines.join('\n');
            })()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProWelcome && (
          <motion.div
            className="pro-welcome-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={e => {
              if (e.target === e.currentTarget) setShowProWelcome(false);
            }}
          >
            <motion.div
              className="pro-welcome-card"
              initial={{ scale: 0.92, opacity: 0, y: 24 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 24 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            >
              <button className="pro-welcome-close" onClick={() => setShowProWelcome(false)}>
                ✕
              </button>
              <div className="pro-welcome-logo">B&gt;</div>
              <h2 className="pro-welcome-headline">You&apos;re Pro now.</h2>
              <p className="pro-welcome-sub">No limits. No anxiety. Build whatever you want.</p>
              <ul className="pro-welcome-list">
                <li>
                  <span>◈</span> Unlimited builds — generate as much as you like
                </li>
                <li>
                  <span>⬡</span> Based AI — Claude Sonnet, not free-tier Llama
                </li>
                <li>
                  <span>◉</span> AI memory — remembers your style across every session
                </li>
                <li>
                  <span>⊙</span> All creative tools — images, video, and music
                </li>
              </ul>
              <p className="pro-welcome-founder">
                You&apos;re supporting a one-person team in Singapore. This directly funds the next
                feature. Thank you.
              </p>
              <button className="pro-welcome-btn" onClick={() => setShowProWelcome(false)}>
                Start building →
              </button>
            </motion.div>
          </motion.div>
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
                    try {
                      const headers = await getHeaders();
                      const res = await fetch('/api/gallery', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                          shareId,
                          authorName:
                            galleryAuthorName || user?.email?.split('@')[0] || 'Anonymous',
                        }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok) {
                        setGalleryPublished(true);
                        setShowGalleryPublish(false);
                      } else {
                        // Never fail silently — the user clicked Publish and
                        // nothing appearing in the gallery is the exact bug.
                        console.error('[gallery] publish failed', data?.error ?? res.status);
                        alert(
                          'Publish failed: ' +
                            (data?.error ?? `HTTP ${res.status}`) +
                            '. Try Share again, then Publish.'
                        );
                      }
                    } catch (e: unknown) {
                      console.error('[gallery] publish error', e);
                      alert('Publish failed: ' + (e instanceof Error ? e.message : String(e)));
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

      <footer style={{ textAlign: 'center', padding: '8px', fontSize: '11px', opacity: 0.4 }}>
        <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>
          Privacy Policy
        </a>
      </footer>
    </div>
  );
}
