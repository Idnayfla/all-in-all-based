# Phase 1 — Auth + Cloud Storage Implementation Plan

> **STATUS: ✅ COMPLETE** — All tasks implemented and live at getbased.dev (as of 2026-05-14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-user localStorage + shared Redis with Supabase-backed per-user accounts supporting email/password and OAuth (Google, GitHub, Microsoft, Apple), syncing all projects, memory, and settings to the cloud.

**Architecture:** Supabase handles auth (session management, OAuth flows). All data reads/writes go through Next.js API routes using the Supabase service key — no client ever calls Supabase data APIs directly. `app/page.tsx` loads data on login and saves on change. `components/ChatPanel.tsx` adds auth headers to its `/api/memory` call.

**Tech Stack:** `@supabase/supabase-js` 2.x, Supabase PostgreSQL (projects + user_settings tables), Framer Motion (AuthModal), existing Next.js App Router pattern.

---

## File Map

| File                             | Action | Responsibility                                     |
| -------------------------------- | ------ | -------------------------------------------------- |
| `lib/supabase.ts`                | Create | Browser Supabase client (anon key, session only)   |
| `app/api/_auth.ts`               | Create | Server `getUserId()` helper + admin client         |
| `app/auth/callback/page.tsx`     | Create | OAuth redirect landing page                        |
| `app/api/settings/route.ts`      | Create | GET/PUT personality + global memory                |
| `app/api/projects/route.ts`      | Create | GET list + POST create project                     |
| `app/api/projects/[id]/route.ts` | Create | GET/PUT/DELETE single project                      |
| `app/api/migrate/route.ts`       | Create | One-time localStorage→Supabase import              |
| `app/api/memory/route.ts`        | Modify | Replace Redis with Supabase user_settings          |
| `app/api/memory/save/route.ts`   | Modify | Replace Redis with Supabase user_settings          |
| `components/AuthModal.tsx`       | Create | Sign in / sign up / OAuth modal                    |
| `app/globals.css`                | Modify | Auth modal + user avatar styles                    |
| `app/page.tsx`                   | Modify | Session check, API data loading, migration, avatar |
| `components/ChatPanel.tsx`       | Modify | Auth header on `/api/memory` POST                  |

---

## Task 1: Install Supabase and configure environment

**Files:**

- Modify: `package.json` (via npm install)
- Modify: `.env.local`

- [ ] **Step 1: Install @supabase/supabase-js**

```bash
cd /workspaces/all-in-all-based
npm install @supabase/supabase-js
```

Expected output: `added 1 package` (or similar, no errors).

- [ ] **Step 2: Add env vars to .env.local**

Open `.env.local` and append (replace placeholder values with real ones from Supabase dashboard → Settings → API):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

`NEXT_PUBLIC_*` vars are safe to expose (used for auth session only). `SUPABASE_SERVICE_KEY` is server-side only — never expose it to the client.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @supabase/supabase-js"
```

---

## Task 2: Create Supabase database tables

**Files:** None (SQL run in Supabase dashboard)

- [ ] **Step 1: Open Supabase SQL editor**

Go to your Supabase project → SQL Editor → New query.

- [ ] **Step 2: Run the schema SQL**

```sql
-- Projects table: one row per project per user
create table if not exists projects (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  files       jsonb       not null default '[]',
  messages    jsonb       not null default '[]',
  memory      text        not null default '',
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx on projects(user_id);
create index if not exists projects_updated_at_idx on projects(updated_at desc);

-- User settings: one row per user
create table if not exists user_settings (
  user_id        uuid         primary key references auth.users(id) on delete cascade,
  personality    text         not null default '',
  global_memory  text         not null default '',
  updated_at     timestamptz  not null default now()
);

-- Auto-update updated_at on row changes
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger update_projects_updated_at
  before update on projects
  for each row execute function update_updated_at_column();

create or replace trigger update_user_settings_updated_at
  before update on user_settings
  for each row execute function update_updated_at_column();

-- Disable RLS: server enforces isolation via service key
alter table projects disable row level security;
alter table user_settings disable row level security;
```

Expected: "Success. No rows returned."

- [ ] **Step 3: Verify tables exist**

Run in SQL editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('projects', 'user_settings');
```

Expected: two rows returned — `projects` and `user_settings`.

---

## Task 3: Configure OAuth providers in Supabase

**Files:** None (Supabase dashboard config)

- [ ] **Step 1: Enable Google OAuth**

Supabase dashboard → Authentication → Providers → Google → Enable.
Set `Client ID` and `Client Secret` from Google Cloud Console → APIs & Services → Credentials.
Add `https://your-project-id.supabase.co/auth/v1/callback` as Authorized Redirect URI in Google.

- [ ] **Step 2: Enable GitHub OAuth**

Supabase → Providers → GitHub → Enable.
Create OAuth App at github.com/settings/developers → `Authorization callback URL`: `https://your-project-id.supabase.co/auth/v1/callback`.

- [ ] **Step 3: Enable Microsoft OAuth**

Supabase → Providers → Azure → Enable.
Register app at portal.azure.com → App registrations → Redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`.

- [ ] **Step 4: Enable Apple OAuth**

Supabase → Providers → Apple → Enable.
Requires Apple Developer account. Follow Supabase Apple setup guide for service ID and key.

- [ ] **Step 5: Set site URL**

Supabase → Authentication → URL Configuration → Site URL: `http://localhost:3000` (dev) / your production URL.
Add `http://localhost:3000/auth/callback` to Additional Redirect URLs.

---

## Task 4: Create browser Supabase client

**Files:**

- Create: `lib/supabase.ts`

- [ ] **Step 1: Create lib directory and file**

```bash
mkdir -p /workspaces/all-in-all-based/lib
```

- [ ] **Step 2: Write lib/supabase.ts**

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: add browser Supabase client"
```

---

## Task 5: Create server-side auth helper

**Files:**

- Create: `app/api/_auth.ts`

- [ ] **Step 1: Write app/api/\_auth.ts**

```ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function getUserId(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/_auth.ts
git commit -m "feat: add server-side Supabase auth helper"
```

---

## Task 6: Create OAuth callback page

**Files:**

- Create: `app/auth/callback/page.tsx`

- [ ] **Step 1: Create directory and page**

```bash
mkdir -p /workspaces/all-in-all-based/app/auth/callback
```

- [ ] **Step 2: Write app/auth/callback/page.tsx**

```tsx
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Supabase automatically detects the session from the URL hash/code
    // and fires SIGNED_IN once it's done. We just wait and redirect.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        router.replace('/');
      }
    });

    // Fallback: if session is already set (page reload), redirect immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0d0d0d',
        color: '#a0a0a0',
        fontFamily: 'monospace',
        fontSize: '14px',
      }}
    >
      Signing in...
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/auth/callback/page.tsx
git commit -m "feat: add OAuth callback page"
```

---

## Task 7: Create settings API route

**Files:**

- Create: `app/api/settings/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p /workspaces/all-in-all-based/app/api/settings
```

- [ ] **Step 2: Write app/api/settings/route.ts**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('personality, global_memory')
      .eq('user_id', userId)
      .single();
    return NextResponse.json({
      personality: data?.personality ?? '',
      globalMemory: data?.global_memory ?? '',
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const body = await req.json();
    const upsertData: Record<string, string> = { user_id: userId };
    if (body.personality !== undefined) upsertData.personality = body.personality;
    if (body.globalMemory !== undefined) upsertData.global_memory = body.globalMemory;
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert(upsertData, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/settings/route.ts
git commit -m "feat: add /api/settings GET+PUT route"
```

---

## Task 8: Create projects list + create API route

**Files:**

- Create: `app/api/projects/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p /workspaces/all-in-all-based/app/api/projects
```

- [ ] **Step 2: Write app/api/projects/route.ts**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, files, messages, memory, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const projects = data.map(p => ({
      id: p.id,
      name: p.name,
      files: p.files,
      messages: p.messages,
      memory: p.memory,
      updatedAt: new Date(p.updated_at).getTime(),
    }));
    return NextResponse.json({ projects });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ user_id: userId, name: name.trim(), files: [], messages: [], memory: '' })
      .select('id, name, files, messages, memory, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({
      project: {
        id: data.id,
        name: data.name,
        files: data.files,
        messages: data.messages,
        memory: data.memory,
        updatedAt: new Date(data.updated_at).getTime(),
      },
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/route.ts
git commit -m "feat: add /api/projects GET+POST route"
```

---

## Task 9: Create single project API route

**Files:**

- Create: `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p "/workspaces/all-in-all-based/app/api/projects/[id]"
```

- [ ] **Step 2: Write app/api/projects/[id]/route.ts**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('id, name, files, messages, memory, updated_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return NextResponse.json({
      project: {
        id: data.id,
        name: data.name,
        files: data.files,
        messages: data.messages,
        memory: data.memory,
        updatedAt: new Date(data.updated_at).getTime(),
      },
    });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.files !== undefined) updates.files = body.files;
    if (body.messages !== undefined) updates.messages = body.messages;
    if (body.memory !== undefined) updates.memory = body.memory;
    if (Object.keys(updates).length === 0) return NextResponse.json({ success: true });
    const { error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const userId = await getUserId(req);
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/api/projects/[id]/route.ts"
git commit -m "feat: add /api/projects/[id] GET+PUT+DELETE route"
```

---

## Task 10: Create migration API route

**Files:**

- Create: `app/api/migrate/route.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p /workspaces/all-in-all-based/app/api/migrate
```

- [ ] **Step 2: Write app/api/migrate/route.ts**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { projects, personality, globalMemory } = await req.json();

    if (Array.isArray(projects) && projects.length > 0) {
      const rows = projects.map((p: any) => ({
        id: p.id,
        user_id: userId,
        name: p.name ?? 'Untitled',
        files: p.files ?? [],
        messages: (p.messages ?? []).map((m: any) => ({
          ...m,
          content: Array.isArray(m.content)
            ? m.content.map((b: any) =>
                b.type === 'image' ? { type: 'text', text: '[image]' } : b
              )
            : m.content,
        })),
        memory: p.memory ?? '',
        updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from('projects').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    await supabaseAdmin.from('user_settings').upsert(
      {
        user_id: userId,
        personality: personality ?? '',
        global_memory: globalMemory ?? '',
      },
      { onConflict: 'user_id' }
    );

    return NextResponse.json({ migrated: projects?.length ?? 0 });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/migrate/route.ts
git commit -m "feat: add /api/migrate one-time localStorage import route"
```

---

## Task 11: Update memory routes to use Supabase

**Files:**

- Modify: `app/api/memory/route.ts`
- Modify: `app/api/memory/save/route.ts`

- [ ] **Step 1: Rewrite app/api/memory/route.ts**

Replace the entire file:

```ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getUserId, supabaseAdmin } from '../_auth';

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as any[])
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n');
  }
  return '';
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { data } = await supabaseAdmin
      .from('user_settings')
      .select('global_memory')
      .eq('user_id', userId)
      .single();
    return NextResponse.json({ memory: data?.global_memory ?? '' });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ apiKey: process.env.APP_ANTHROPIC_API_KEY });
  try {
    const userId = await getUserId(req);
    const { messages } = await req.json();

    const conversation = (messages as any[])
      .map(m => `${String(m.role).toUpperCase()}: ${contentToText(m.content)}`)
      .join('\n');

    const { data: settingsData } = await supabaseAdmin
      .from('user_settings')
      .select('global_memory')
      .eq('user_id', userId)
      .single();
    const existing = settingsData?.global_memory ?? '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are a memory extractor. Based on this conversation, extract key facts about the user (preferences, skills, projects, goals, personal details) and merge with existing memory.

EXISTING MEMORY:
${existing || 'None yet'}

NEW CONVERSATION:
${conversation}

Return ONLY a plain numbered list. Max 20 items. Format exactly like:
1) Fact about the user
2) Another fact
3) Another fact

STRICT RULES:
- No headers
- No bold text, no asterisks, no markdown whatsoever
- No categories or labels
- Just plain sentences
- If nothing new to add, return existing memory unchanged.`,
        },
      ],
    });

    const newMemory = response.content[0].type === 'text' ? response.content[0].text : existing;

    await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: userId, global_memory: newMemory }, { onConflict: 'user_id' });

    return NextResponse.json({ memory: newMemory });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rewrite app/api/memory/save/route.ts**

Replace the entire file:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserId, supabaseAdmin } from '../../_auth';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    const { memory } = await req.json();
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: userId, global_memory: memory ?? '' }, { onConflict: 'user_id' });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/memory/route.ts app/api/memory/save/route.ts
git commit -m "feat: replace Redis memory with Supabase user_settings"
```

---

## Task 12: Create AuthModal component

**Files:**

- Create: `components/AuthModal.tsx`

- [ ] **Step 1: Write components/AuthModal.tsx**

```tsx
'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

type Tab = 'signin' | 'signup';

const OAUTH_PROVIDERS = [
  { id: 'google' as const, label: 'Google', icon: 'G' },
  { id: 'github' as const, label: 'GitHub', icon: '⌥' },
  { id: 'azure' as const, label: 'Microsoft', icon: 'M' },
  { id: 'apple' as const, label: 'Apple', icon: '' },
];

export default function AuthModal() {
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const clearForm = () => {
    setEmail('');
    setPassword('');
    setConfirm('');
    setError('');
    setMessage('');
  };

  const handleOAuth = async (provider: (typeof OAUTH_PROVIDERS)[number]['id']) => {
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMessage('Check your inbox to verify your email.');
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    if (error) setError(error.message);
    else setMessage('Password reset email sent.');
  };

  return (
    <motion.div
      className="auth-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="auth-box"
        initial={{ opacity: 0, scale: 0.94, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: -12 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <div className="auth-logo">B&gt;</div>
        <div className="auth-title">Welcome to Based</div>

        <div className="auth-oauth-grid">
          {OAUTH_PROVIDERS.map(p => (
            <button key={p.id} className="auth-oauth-btn" onClick={() => handleOAuth(p.id)}>
              <span className="auth-oauth-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signin' ? ' active' : ''}`}
            onClick={() => {
              setTab('signin');
              clearForm();
            }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab${tab === 'signup' ? ' active' : ''}`}
            onClick={() => {
              setTab('signup');
              clearForm();
            }}
          >
            Sign Up
          </button>
        </div>

        {message ? (
          <div className="auth-message">{message}</div>
        ) : (
          <form onSubmit={tab === 'signin' ? handleSignIn : handleSignUp}>
            <input
              className="auth-input"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
            />
            {tab === 'signup' && (
              <input
                className="auth-input"
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            )}
            {error && <div className="auth-error">{error}</div>}
            <motion.button
              className="auth-submit"
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.97 }}
            >
              {loading ? '...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </motion.button>
            {tab === 'signin' && (
              <button type="button" className="auth-forgot" onClick={handleForgotPassword}>
                Forgot password?
              </button>
            )}
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/AuthModal.tsx
git commit -m "feat: add AuthModal with email/password + OAuth"
```

---

## Task 13: Add CSS for AuthModal and user avatar

**Files:**

- Modify: `app/globals.css`

- [ ] **Step 1: Append styles to app/globals.css**

Add the following at the end of `app/globals.css`:

```css
/* ── Auth Modal ── */
.auth-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.auth-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 32px;
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.auth-logo {
  font-size: 24px;
  font-weight: 700;
  color: var(--accent);
  text-align: center;
  letter-spacing: 2px;
}
.auth-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
}
.auth-oauth-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.auth-oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.auth-oauth-btn:hover {
  border-color: var(--accent);
  background: var(--surface);
}
.auth-oauth-icon {
  font-size: 15px;
  font-weight: 700;
}
.auth-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
}
.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.auth-tabs {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}
.auth-tab {
  flex: 1;
  padding: 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.auth-tab.active {
  background: var(--surface);
  color: var(--text);
}
.auth-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.auth-input:focus {
  outline: none;
  border-color: var(--accent);
}
.auth-error {
  font-size: 12px;
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.2);
  border-radius: 6px;
  padding: 8px 10px;
}
.auth-message {
  font-size: 13px;
  color: #6bcb77;
  background: rgba(107, 203, 119, 0.1);
  border: 1px solid rgba(107, 203, 119, 0.2);
  border-radius: 6px;
  padding: 12px;
  text-align: center;
}
.auth-submit {
  width: 100%;
  padding: 11px;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.auth-submit:hover {
  opacity: 0.9;
}
.auth-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth-forgot {
  width: 100%;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  padding: 4px;
  transition: color 0.15s;
}
.auth-forgot:hover {
  color: var(--accent);
}

/* ── User Avatar ── */
.user-avatar-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  overflow: hidden;
  transition: opacity 0.15s;
}
.user-avatar-btn:hover {
  opacity: 0.85;
}
.user-avatar-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.auth-signout-btn {
  width: 100%;
  padding: 9px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.25);
  border-radius: 8px;
  color: #ff6b6b;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  margin-top: 8px;
}
.auth-signout-btn:hover {
  background: rgba(255, 107, 107, 0.15);
}
```

- [ ] **Step 2: Type-check (CSS doesn't need tsc, verify build)**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add auth modal and user avatar CSS"
```

---

## Task 14: Update app/page.tsx for cloud auth and data

**Files:**

- Modify: `app/page.tsx`

- [ ] **Step 1: Replace app/page.tsx with cloud-aware version**

Replace the entire file content with:

```tsx
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
import { supabase } from '@/lib/supabase';
import { LOGO_DEFAULTS } from '@/hooks/useLogoConfig';

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

const DEFAULT_PERSONALITY =
  'You are Based, the AI inside All in All Based — a sharp, witty, and direct coding assistant. You are confident, occasionally funny, and always helpful. You treat the user like a smart friend, not a customer. You get straight to the point, never over-explain, and celebrate when things work.';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectType, setProjectType] = useState('html');
  const [personality, setPersonality] = useState(DEFAULT_PERSONALITY);
  const [showSettings, setShowSettings] = useState(false);
  const [globalMemory, setGlobalMemory] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [incognitoMessages, setIncognitoMessages] = useState<Message[]>([]);
  const [activePanel, setActivePanel] = useState<'chat' | 'editor' | 'preview' | 'debug'>('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projectModal, setProjectModal] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
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
        setProjects([]);
        setCurrentProject(null);
        setFiles([]);
        setMessages([]);
        setActiveFile(null);
        setGlobalMemory('');
        setPersonality(DEFAULT_PERSONALITY);
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
    setProjects(prev => prev.map(p => (p.id === updated.id ? updated : p)));
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

  const deleteProject = async (id: string) => {
    const headers = await getHeaders();
    fetch(`/api/projects/${id}`, { method: 'DELETE', headers }).catch(() => {});
    setProjects(prev => prev.filter(p => p.id !== id));
    if (currentProject?.id === id) {
      setCurrentProject(null);
      setFiles([]);
      setMessages([]);
      setActiveFile(null);
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
      <header className="app-header">
        <div className="logo">
          <LogoDisplay config={LOGO_DEFAULTS} />
          {currentProject && <span className="project-name-display">{currentProject.name}</span>}
        </div>
        <nav className="header-nav">
          <div className="tab-switcher">
            <button
              className={`tab-btn ${activePanel === 'chat' ? 'active' : ''}`}
              onClick={() => setActivePanel('chat')}
            >
              Chat
            </button>
            <button
              className={`tab-btn ${activePanel === 'editor' ? 'active' : ''}`}
              onClick={() => setActivePanel('editor')}
            >
              Editor
            </button>
            <button
              className={`tab-btn ${activePanel === 'preview' ? 'active' : ''}`}
              onClick={() => setActivePanel('preview')}
            >
              Preview
            </button>
            <button
              className={`tab-btn tab-btn-debug ${activePanel === 'debug' ? 'active' : ''}`}
              onClick={() => setActivePanel('debug')}
              title="Debug stream"
            >
              ⚡
            </button>
          </div>
          <div className="header-controls">
            <button
              className={`icon-btn ${incognito ? 'incognito-active' : ''}`}
              onClick={() => {
                setIncognito(s => !s);
                setIncognitoMessages([]);
                setActivePanel('chat');
              }}
              title="Temp chat — no memory saved"
            >
              🕵️
            </button>
            <button
              className={`icon-btn ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(s => !s)}
              title="Settings"
              aria-label="Toggle settings"
            >
              ⚙
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
                <div className="settings-hint">
                  This shapes how Based talks and thinks. Changes apply immediately.
                </div>
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
                <div className="settings-hint">
                  Auto-updated after each conversation. Based remembers this across all projects.
                </div>
                <button
                  className="run-btn"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    const headers = await getHeaders();
                    await fetch('/api/memory/save', {
                      method: 'POST',
                      headers,
                      body: JSON.stringify({ memory: globalMemory }),
                    });
                  }}
                >
                  Save Memory
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
                  <div className="settings-hint" style={{ marginBottom: 4 }}>
                    Signed in as {user.email}
                  </div>
                  <button className="auth-signout-btn" onClick={signOut}>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}

          {incognito ? (
            <div className="panel panel-active">
              <div className="incognito-banner">
                🕵️ Incognito Mode — chat will be wiped when you exit
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
                incognito={true}
              />
            </div>
          ) : !currentProject ? (
            <div className="no-project">
              <div className="chat-empty-logo" aria-hidden="true">
                B&gt;
              </div>
              <div className="no-project-title">BASED</div>
              <div className="no-project-sub">Open a project or start a new one.</div>
              <button className="new-project-btn-large" onClick={newProject}>
                + New Project
              </button>
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
              <div className={`panel ${activePanel === 'debug' ? 'panel-active' : ''}`}>
                <DebugPanel />
              </div>
            </>
          )}
        </main>
      </div>

      <AnimatePresence>
        {projectModal && (
          <ProjectNameModal onConfirm={createProject} onCancel={() => setProjectModal(false)} />
        )}
        {authReady && !user && <AuthModal key="auth-modal" />}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test in browser**

```bash
npm run dev
```

Open http://localhost:3000. Expected: AuthModal appears. Sign up with a test email. After verification, app loads with empty project list. Create a project — verify it appears. Refresh page — project still there (loaded from Supabase).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire Supabase auth + cloud data loading into page.tsx"
```

---

## Task 15: Add auth headers to ChatPanel memory call

**Files:**

- Modify: `components/ChatPanel.tsx`

The memory extraction call (`POST /api/memory`) needs an auth header. Find the existing call and add the header.

- [ ] **Step 1: Add supabase import at top of ChatPanel.tsx**

At the top of `components/ChatPanel.tsx`, after existing imports, add:

```ts
import { supabase } from '@/lib/supabase';
```

- [ ] **Step 2: Find the memory POST call**

Search for `fetch('/api/memory'` in `components/ChatPanel.tsx`. It looks like:

```ts
await fetch('/api/memory', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: finalMessages }),
});
```

- [ ] **Step 3: Replace with auth-header version**

```ts
const {
  data: { session },
} = await supabase.auth.getSession();
await fetch('/api/memory', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  },
  body: JSON.stringify({ messages: finalMessages }),
});
```

- [ ] **Step 4: Find the memory/save call in page.tsx (already handled in Task 14)**

The `Save Memory` button in Settings already uses `getHeaders()` in the updated `page.tsx` from Task 14. No further change needed here.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ChatPanel.tsx
git commit -m "feat: add auth header to ChatPanel memory extraction call"
```

---

## Task 16: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test sign up flow**

Open http://localhost:3000. AuthModal appears. Click "Sign Up" tab. Enter email + password (8+ chars). Submit. Verify "Check your inbox" message appears. Check email → click verification link → redirected to app → signed in.

- [ ] **Step 3: Test OAuth flow**

Sign out. Click "Google" button → Google consent → redirected back → signed in with Google account. Avatar shows in header.

- [ ] **Step 4: Test project CRUD**

Create a project → appears in sidebar. Add a chat message (generates something). Refresh page → project still loaded with messages. Rename project → name updates. Delete project → removed.

- [ ] **Step 5: Test cross-device sync**

Sign in on a second browser/incognito window with the same account. Verify same projects appear.

- [ ] **Step 6: Test memory persistence**

Have a conversation. Open Settings → Global Memory should show extracted facts. Refresh page → memory still there. Sign in on second browser → same memory appears.

- [ ] **Step 7: Test migration (if applicable)**

Temporarily add some data to localStorage (`forge_projects` key) as JSON matching Project shape. Sign in with a fresh account. Verify projects appear in the app and localStorage is cleared.

- [ ] **Step 8: Final commit and push**

```bash
git add -A
git commit -m "feat: Phase 1 complete — Supabase auth + cloud storage"
git push
```

---

## Self-Review

**Spec coverage check:**

- ✅ Email/password sign up with verification email
- ✅ Email/password sign in
- ✅ Google / GitHub / Microsoft / Apple OAuth
- ✅ Supabase PostgreSQL tables (projects + user_settings)
- ✅ Server-side API routes for all data access
- ✅ Auth header pattern on all API routes
- ✅ `getUserId()` shared helper
- ✅ OAuth callback page
- ✅ Projects CRUD (GET list, POST create, GET one, PUT update, DELETE)
- ✅ Settings GET/PUT (personality + global memory)
- ✅ Migration from localStorage on first login
- ✅ AuthModal with Framer Motion animations
- ✅ User avatar in header
- ✅ Sign out in Settings panel
- ✅ Memory routes replaced Redis with Supabase
- ✅ ChatPanel memory call has auth header
- ✅ Auto-save project to cloud on files/messages change
- ✅ Works in all browsers (web)
- ✅ Compatible with Phase 3 mobile (Supabase Auth works in Expo)
- ✅ Apple OAuth included for App Store compliance (Phase 4)

**Placeholder scan:** None found.

**Type consistency:** `Project` shape used identically across page.tsx, API routes, and migration. `getUserId()` imported from `../_auth` consistently in all routes.
