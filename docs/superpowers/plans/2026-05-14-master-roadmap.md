# getbased.dev — Master Roadmap

Last updated: 2026-05-14

## Full Product Plan (10 Phases)

| Phase | What                            | Key Tech Needed                                                       |
|-------|---------------------------------|-----------------------------------------------------------------------|
| 1     | Auth + cloud storage            | Supabase / PlanetScale + NextAuth                                     |
| 2     | Custom design system            | Design tokens, typography, Framer Motion                              |
| 3     | Mobile app (Android + iOS)      | Expo / React Native or Capacitor                                      |
| 4     | App Store + Play Store          | Apple Dev account ($99/yr), Google ($25 one-time), review process     |
| 5     | Subscriptions                   | Stripe, pricing tiers, webhooks                                       |
| 6     | Public release infra            | Vercel Pro / AWS, CDN, monitoring                                     |
| 7     | Real-time tools                 | Tavily / Brave search API, weather API                                |
| 8     | Document export                 | pdf-lib, docx, xlsx, pptx libraries                                   |
| 9     | Music AI                        | FAL music models / Suno-like API                                      |
| 10    | Memory tab redesign             | Per-user Redis/DB, better UI                                          |

---

## Phase 1 — Auth + Cloud Storage ✅ COMPLETE
**Key Tech:** Supabase / PlanetScale + NextAuth

| Feature | Status |
|---------|--------|
| Account Registry (Supabase Auth) | ✅ Done |
| Email + Password login | ✅ Done |
| GitHub OAuth | ✅ Done |
| Google OAuth | ✅ Done |
| Forgot password / email reset | ✅ Done |
| Data synced across devices (Supabase DB) | ✅ Done |
| Projects CRUD (cloud) | ✅ Done |
| Memory + Settings synced to cloud | ✅ Done |
| LocalStorage migration on first login | ✅ Done |

---

## Phase 2 — Custom Design System 🔄 IN PROGRESS
**Key Tech:** Design tokens, typography, Framer Motion

> Phase 2 is **not** just light/dark mode — it's a full design system: tokens, typography scale, motion language, polished components, consistent spacing.

| Feature | Status | Notes |
|---------|--------|-------|
| **Polish / Bugfixes (prereqs)** | | |
| Fix publish button hidden behind header (mobile) | ✅ Done | Removed sticky + z-index from app-header |
| Fix phone zoom on input focus | ✅ Done | `font-size: 16px` on inputs + `touch-action: manipulation` |
| Fix settings panel positioning + empty space at top | ✅ Done | Removed double-offset (`top: 52px` inside already-offset `.app-body`) |
| Smooth sidebar (remove chunky borders + asymmetric panel) | ✅ Done | Symmetric border-radius, soft shadow, restored right border |
| **Memory UI** | | |
| Shared memories across chats | ✅ Done | Individual memory chips with add/edit/delete modal |
| Memory tab redesign (Phase 10 merged here) | ✅ Done | Chip UI complete |
| **Theming (subset of design system)** | | |
| Light / Dark / OLED mode toggle | ✅ Done | ThemeCustomizer |
| Accent color customization (swatches + picker) | ✅ Done | ThemeCustomizer |
| Custom font selection (mono) | ✅ Done | ThemeCustomizer — 4 fonts |
| Theme persistence to cloud (Supabase jsonb) | ✅ Done | API + localStorage 3-tier sync |
| **Design Tokens** | | |
| Formal design token system (colors, spacing, radius, shadow) | ✅ Done | 50+ tokens in :root — radius, spacing, font-size, shadow, accent-opacity scales |
| Typography scale (display / body / mono with sizes 1–6) | ✅ Done | --fs-2xs through --fs-hero |
| Spacing scale (4/8/12/16/24/32...) consistently applied | ✅ Done | --sp-1 through --sp-8 |
| Border-radius scale | ✅ Done | --r-sm/md/lg/xl/2xl/full — all major radii migrated |
| **Motion / Framer Motion** | | |
| Install + configure framer-motion (already installed ✅) | ✅ Done | Dependency present |
| Page / panel transitions (settings open, sidebar slide) | ✅ Done | Settings panel: AnimatePresence + spring; Sidebar: spring width |
| Message arrival animations in chat | ✅ Done | ChatPanel uses motion.div + AnimatePresence throughout |
| Splash → app transition polish | ✅ Done | CSS clip-path wipe (intentional — appropriate for particle-canvas complexity) |
| Hover / press micro-interactions (buttons, items) | ✅ Done | ChatPanel motion.button; sidebar item transitions |
| **Component Polish** | | |
| Audit all buttons for consistent style + sizing | ✅ Done | --accent-hover token; --disabled-opacity normalised; !important removed |
| Form controls (inputs, selects) consistent styling | ✅ Done | Radius tokens applied; focus states consistent |
| Empty states across the app | ✅ Done | editor-empty + preview-empty upgraded to icon+text structure |
| Loading / skeleton states | ✅ Done | --skeleton-bg token + .skeleton pulse class added |

---

## Phase 3 — Mobile App
**Key Tech:** Expo / React Native or Capacitor

| Feature | Status | Notes |
|---------|--------|-------|
| Android + iOS compatibility | 🔄 In Progress | PWA complete; Capacitor installed + configured — run `npm run cap:add:android` / `cap:add:ios` then open in Android Studio / Xcode |
| Voice activation (Siri-like) | ✅ Done | useVoiceActivation hook — say "Based, ..." to trigger |
| Ambient personal AI companion | ✅ Done | CompanionDrawer — floating trigger, voice + text, screen capture |
| Desktop app (Electron / Tauri) | ✅ Done | Electron — loads from Vercel, builds .exe/.dmg/.AppImage via `npm run electron:build` |

---

## Phase 4 — App Store + Play Store
**Key Tech:** Apple Dev account ($99/yr), Google ($25 one-time), review process

| Feature | Status | Notes |
|---------|--------|-------|
| iOS App Store submission | ⬜ Todo | Requires Apple Dev account + review |
| Android Play Store submission | ⬜ Todo | PWA via TWA or React Native wrapper |

---

## Phase 5 — Subscriptions
**Key Tech:** Stripe, pricing tiers, webhooks

| Feature | Status | Notes |
|---------|--------|-------|
| Stripe integration | ⬜ Todo | |
| Pricing tiers | ⬜ Todo | Free / Pro / Team |
| Webhook handling | ⬜ Todo | Subscription lifecycle events |

---

## Phase 6 — Public Release Infrastructure
**Key Tech:** Vercel Pro / AWS, CDN, monitoring

| Feature | Status | Notes |
|---------|--------|-------|
| Production hosting | ⬜ Todo | Vercel Pro or AWS |
| CDN setup | ⬜ Todo | |
| Monitoring + alerting | ⬜ Todo | |
| Public launch | ⬜ Todo | After Phase 5 complete |

---

## Phase 7 — Real-time Tools
**Key Tech:** Tavily / Brave Search API, weather API

| Feature | Status | Notes |
|---------|--------|-------|
| AI internet access | ⬜ Todo | Tavily or Brave search integration |
| Real-time data (weather, news, etc.) | ⬜ Todo | |
| Personal device data access | ⬜ Todo | |

---

## Phase 8 — Document Export
**Key Tech:** pdf-lib, docx, xlsx, pptx libraries

| Feature | Status | Notes |
|---------|--------|-------|
| PDF export | ⬜ Todo | pdf-lib |
| Docx export | ⬜ Todo | docx library |
| Excel export | ⬜ Todo | xlsx library |
| PowerPoint export | ⬜ Todo | pptx library |

---

## Phase 9 — Music AI
**Key Tech:** FAL music models / Suno-like API

| Feature | Status | Notes |
|---------|--------|-------|
| Music generation feature | ⬜ Todo | FAL.ai or Suno API |

---

## Phase 10 — Memory Tab Redesign
**Key Tech:** Per-user Redis/DB, better UI

| Feature | Status | Notes |
|---------|--------|-------|
| Per-user memory storage | ✅ Done | Supabase `user_settings.global_memory` |
| Better UI (chip-based) | ✅ Done | Merged into Phase 2 work |

---

## Add-ons / Ongoing

| Item | Status |
|------|--------|
| Animation packages (framer-motion, gsap, lenis) | ✅ Installed |
| Splash screen | ✅ Done |
| Personality panel | ✅ Done |
| Image generation | ✅ Done |
| Video generation | ✅ Done |
| Personal AI API for developers | ⬜ Todo | Expose Based as an API — devs can call it to get AI-generated apps/code |
| Codespace → VS Code direct workflow | ⬜ Todo | Open Codespace directly in VS Code Desktop (not browser) |
| **Cross-project referencing** | ⬜ Todo | When chatting in Project A, mention "like in Project B" — Claude pulls that project's files/context and uses it as reference (e.g. "same auth flow as my TodoApp"). UI: `@ProjectName` mention in chat; backend: load target project's files into context alongside current chat. |
