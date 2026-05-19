# Design: Phase 1 — Auth + Cloud Storage

**Date:** 2026-05-09  
**Status:** Approved — ready for implementation planning  
**Depends on:** Nothing (this is the foundation)  
**Unlocks:** Phase 2 (design system), Phase 3 (mobile), Phase 5 (subscriptions), Phase 10 (memory redesign)

---

## Summary

Replace the current single-user localStorage + shared Redis storage with real per-user accounts backed by Supabase. Users sign in with email/password or social OAuth (Google, GitHub, Microsoft, Apple). All data — projects, files, messages, memory, settings — syncs to the cloud and is accessible on any device or platform (web browser, Android, iOS).

---

## Architecture

**Approach:** Supabase Auth + Next.js server-side API routes

- Supabase handles authentication and PostgreSQL storage
- All data access goes through existing `/api/*` Next.js routes (service key stays server-side)
- No client-side Supabase data calls — consistent with the existing codebase pattern
- Frontend sends `Authorization: Bearer <token>` with every request; API routes verify it and scope queries to `user_id`

---

## 1. Database Schema

Two tables in Supabase PostgreSQL. Files and messages are stored as JSONB arrays inside the project row — mirrors the existing TypeScript data model exactly.

```sql
-- One row per project per user
create table projects (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  files       jsonb       not null default '[]',   -- FileNode[]
  messages    jsonb       not null default '[]',   -- Message[]
  memory      text        not null default '',     -- project-level notes
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index projects_user_id_idx on projects(user_id);
create index projects_updated_at_idx on projects(updated_at desc);

-- One row per user
create table user_settings (
  user_id        uuid         primary key references auth.users(id) on delete cascade,
  personality    text         not null default '',
  global_memory  text         not null default '',
  updated_at     timestamptz  not null default now()
);
```

Row Level Security is **disabled** — the server enforces user isolation in code using the Supabase service key. No client ever touches Supabase directly.

---

## 2. Auth Flow

### Sign-in Modal

Appears on app load if no valid session exists. Animated Framer Motion modal (same spring style as `ProjectNameModal`). Closes automatically once authenticated.

**Two tabs: Sign In / Sign Up**

**OAuth buttons (both tabs):** Google · GitHub · Microsoft · Apple  
_(Apple required for iOS App Store compliance — Phase 4)_

### Sign Up (email + password)

1. User enters email, password, confirm password → Submit
2. Supabase creates account, sends verification email
3. Modal shows "Check your inbox to verify your email"
4. User clicks link → redirected back to app → session established
5. First-login migration runs automatically (see Section 5)

### Sign In (email + password)

1. User enters email + password → Submit
2. Supabase validates credentials → returns session token
3. Modal closes, app loads with user's cloud data

### OAuth (Google / GitHub / Microsoft / Apple)

1. User clicks provider button → redirected to provider consent screen
2. Provider redirects to `/auth/callback`
3. `app/auth/callback/route.ts` exchanges the OAuth code for a Supabase session
4. App loads with user's cloud data (first-login migration runs if needed)

### Session Handling

- Supabase JS client (`@supabase/supabase-js`) manages the session cookie
- Session persists across browser restarts — user stays logged in
- All API routes read `Authorization: Bearer <token>` to identify the user
- **Mobile (Phase 3):** OAuth uses deep links (`allinallbased://auth/callback`) instead of browser redirects — no auth rewrite required

### Sign Out

- Button in the Settings panel (bottom)
- Clears Supabase session → AuthModal reappears

### Password Reset

- "Forgot password?" link on Sign In tab
- Supabase sends a reset link to the user's email
- User clicks link → redirected to app with reset token → new password form shown

### Platform Coverage

| Platform                                    | Auth method                | Works?     |
| ------------------------------------------- | -------------------------- | ---------- |
| Web browser (Chrome, Firefox, Safari, Edge) | All                        | ✅ Phase 1 |
| Windows / Mac / Linux desktop browser       | All                        | ✅ Phase 1 |
| Android                                     | All (deep links for OAuth) | ✅ Phase 3 |
| iOS                                         | All + Sign in with Apple   | ✅ Phase 3 |
| Play Store app                              | All                        | ✅ Phase 3 |
| App Store app                               | All + Sign in with Apple   | ✅ Phase 3 |

---

## 3. API Routes

### New Routes

| Route                            | Method | Purpose                                          |
| -------------------------------- | ------ | ------------------------------------------------ |
| `app/auth/callback/route.ts`     | GET    | Exchange OAuth code for session                  |
| `app/api/projects/route.ts`      | GET    | List all projects for authenticated user         |
| `app/api/projects/route.ts`      | POST   | Create new project                               |
| `app/api/projects/[id]/route.ts` | GET    | Load one project                                 |
| `app/api/projects/[id]/route.ts` | PUT    | Save project (files + messages + memory + name)  |
| `app/api/projects/[id]/route.ts` | DELETE | Delete project                                   |
| `app/api/settings/route.ts`      | GET    | Load personality + global memory                 |
| `app/api/settings/route.ts`      | PUT    | Save personality + global memory (upsert)        |
| `app/api/migrate/route.ts`       | POST   | One-time: import localStorage dump into Supabase |

### Modified Existing Routes

All existing routes get a user identity check added at the top:

```ts
// Shared helper — app/api/_auth.ts
import { createClient } from '@supabase/supabase-js';

export async function getUserId(req: NextRequest): Promise<string> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) throw new Error('Unauthorized');
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  return user.id;
}
```

- `app/api/memory/route.ts` — GET reads `user_settings.global_memory`; POST extracts and writes back to `user_settings.global_memory` (replaces Redis)
- `app/api/memory/save/route.ts` — saves to `user_settings.global_memory` (replaces Redis write)
- `app/api/generate/route.ts` — logic unchanged; reads memory/personality from request body (frontend passes them as before)

### Auth Header Pattern (Frontend)

Every fetch to `/api/*` includes the session token:

```ts
const {
  data: { session },
} = await supabase.auth.getSession();
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${session?.access_token ?? ''}`,
};
```

---

## 4. Frontend Changes

### New Files

- `components/AuthModal.tsx` — sign in / sign up modal with Framer Motion animations
- `lib/supabase.ts` — browser Supabase client (anon key only, used for auth session management)
- `app/auth/callback/route.ts` — OAuth callback handler

### `app/page.tsx` Changes

- On mount: check Supabase session → if none, show `<AuthModal />`
- Replace all `localStorage` reads/writes for projects with `/api/projects` calls
- Replace `localStorage` reads/writes for personality with `/api/settings` calls
- On first login: call `/api/migrate` with full localStorage dump → then clear localStorage
- Add user avatar (initials circle or provider avatar) + email in header top-right
- Avatar click → opens Settings panel
- Sign Out button at bottom of Settings panel

### `components/AuthModal.tsx` Design

```
┌─────────────────────────────────────┐
│         Welcome to Based            │
│                                     │
│  [G] Google  [GH] GitHub            │
│  [MS] Microsoft  [] Apple           │
│                                     │
│  ──────────── or ────────────       │
│                                     │
│  [Sign In]  [Sign Up]  ← tabs       │
│                                     │
│  Email ________________________     │
│  Password _____________________     │
│  (Sign Up: Confirm password)        │
│                                     │
│  [Submit]                           │
│  Forgot password?                   │
└─────────────────────────────────────┘
```

- Entry: `initial={{ opacity: 0, scale: 0.94, y: -12 }}` spring stiffness 400 damping 30
- Overlay: fade in/out `duration: 0.15`
- Tab switch: slide animation between Sign In / Sign Up

### `components/Sidebar.tsx` Changes

- Projects loaded from `GET /api/projects` on mount
- Create → `POST /api/projects`
- Rename → `PUT /api/projects/[id]` (name only)
- Delete → `DELETE /api/projects/[id]`

### `components/ChatPanel.tsx` Changes

- Memory extraction after generation: `PUT /api/settings` instead of `POST /api/memory`
- Auto-save project after generation: `PUT /api/projects/[id]`
- All fetches include auth header

---

## 5. Data Migration

Runs automatically once on first login. If localStorage has no projects, migration is skipped silently.

**`POST /api/migrate` flow:**

1. Frontend sends: `{ projects: Project[], personality: string, globalMemory: string }`
2. Server inserts all projects into `projects` table (batch insert)
3. Server upserts `user_settings` with personality + global memory
4. Returns `{ migrated: N }` count
5. Frontend clears localStorage on success

**First-login detection:**

```ts
// After login, check if user has any projects in Supabase
const res = await fetch('/api/projects', { headers });
const { projects } = await res.json();
const hasLocalProjects = localStorage.getItem('projects') !== null;
if (projects.length === 0 && hasLocalProjects) {
  await runMigration(); // call /api/migrate then clear localStorage
}
```

---

## 6. Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...          # safe to expose (used for auth session only)
SUPABASE_SERVICE_KEY=eyJ...                   # server-side only, never exposed to client
```

---

## 7. Error Handling

- **Unauthorized (401):** API routes return `{ error: 'Unauthorized' }` → frontend clears session and shows AuthModal
- **Network error during save:** Show toast "Failed to save — retrying…", retry once, then show "Save failed — check your connection"
- **Migration failure:** Show "Import failed — your local projects are still safe" (do not clear localStorage)
- **OAuth cancelled:** Modal stays open, no error shown
- **Verification email not received:** "Resend verification email" link shown after 30s

---

## 8. Files Created / Modified

| File                             | Change                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| `app/auth/callback/route.ts`     | New — OAuth code exchange                                          |
| `app/api/_auth.ts`               | New — shared `getUserId()` helper                                  |
| `app/api/projects/route.ts`      | New — list + create projects                                       |
| `app/api/projects/[id]/route.ts` | New — get, update, delete project                                  |
| `app/api/settings/route.ts`      | New — get + save user settings                                     |
| `app/api/migrate/route.ts`       | New — one-time localStorage import                                 |
| `app/api/memory/route.ts`        | Modify — replace Redis with Supabase                               |
| `app/api/memory/save/route.ts`   | Modify — replace Redis with Supabase                               |
| `app/page.tsx`                   | Modify — session check, cloud data loading, migration, user avatar |
| `components/AuthModal.tsx`       | New — animated sign in / sign up modal                             |
| `components/ChatPanel.tsx`       | Modify — auth headers on all fetches, auto-save project            |
| `components/Sidebar.tsx`         | Modify — project CRUD via API                                      |
| `lib/supabase.ts`                | New — browser Supabase client                                      |
| `app/globals.css`                | Modify — AuthModal styles, user avatar styles                      |

---

## Out of Scope (Later Phases)

- Team / shared projects (Phase 6)
- Passkeys / biometric auth — Windows Hello, Touch ID (Phase 3)
- Subscription gating (Phase 5)
- Profile picture upload (Phase 2 design system)
- Email preferences / notifications
