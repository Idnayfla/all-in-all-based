# Based — Roadmap

Last updated: 2026-05-19

> **Legend:** ✅ Done · 🔄 In Progress · ⬜ Todo · 🚫 Blocked

---

## Phase 1 — Auth + Cloud Storage ✅ COMPLETE

| Feature                               | Status |
| ------------------------------------- | ------ |
| Supabase Auth (email + password)      | ✅     |
| Google + GitHub OAuth                 | ✅     |
| Forgot password / email reset         | ✅     |
| Projects CRUD synced to cloud         | ✅     |
| Memory + Settings synced to Supabase  | ✅     |
| LocalStorage migration on first login | ✅     |

---

## Phase 2 — Design System ✅ COMPLETE

| Feature                                                     | Status |
| ----------------------------------------------------------- | ------ |
| Design tokens (50+ CSS custom properties)                   | ✅     |
| Typography scale (--fs-2xs → --fs-hero)                     | ✅     |
| Spacing + border-radius scales                              | ✅     |
| Light / Dark / OLED mode                                    | ✅     |
| Accent color customization                                  | ✅     |
| Custom font selection                                       | ✅     |
| Framer Motion — panel + message animations                  | ✅     |
| Component polish (buttons, inputs, empty states, skeletons) | ✅     |

---

## Phase 3 — Mobile App 🔄 IN PROGRESS

| Feature                          | Status | Notes                                    |
| -------------------------------- | ------ | ---------------------------------------- |
| PWA (installable web app)        | ✅     | Works on iOS + Android                   |
| Voice activation ("Based, ...")  | ✅     | useVoiceActivation hook                  |
| Ambient AI companion             | ✅     | CompanionDrawer                          |
| Desktop app (Electron)           | ✅     | .exe/.dmg/.AppImage via electron-builder |
| Capacitor installed + configured | ✅     | Android + iOS targets added              |
| App Store submission (iOS)       | ⬜     | Requires Apple Dev account ($99/yr)      |
| Play Store submission (Android)  | ⬜     | TWA or Capacitor build                   |

---

## Phase 4 — App Store + Play Store ⬜ TODO

| Feature                       | Status | Notes                               |
| ----------------------------- | ------ | ----------------------------------- |
| iOS App Store submission      | ⬜     | After Phase 3 native build complete |
| Android Play Store submission | ⬜     | After Phase 3 native build complete |

---

## Phase 5 — Subscriptions ✅ COMPLETE

| Feature                                   | Status |
| ----------------------------------------- | ------ |
| Stripe checkout integration               | ✅     |
| Stripe customer portal                    | ✅     |
| Webhook handling (subscription lifecycle) | ✅     |
| Free / Pro tiers with generation limits   | ✅     |
| Pro bonus system (referral bonuses)       | ✅     |
| Referral panel                            | ✅     |

---

## Phase 6 — Public Release Infrastructure 🔄 IN PROGRESS

| Feature                                            | Status | Notes                                           |
| -------------------------------------------------- | ------ | ----------------------------------------------- |
| Beta deployment (beta.getbased.dev)                | ✅     | dev branch → Vercel                             |
| Production deployment (getbased.dev)               | ✅     | main branch → Vercel                            |
| Sentry error tracking                              | ✅     | Live on beta as of 2026-05-19                   |
| LangFuse LLM tracing                               | ✅     | Live as of 2026-05-19                           |
| GitHub Actions CI (TS + ESLint + Prettier + build) | ✅     | Runs on every push                              |
| QA stable release gate                             | 🔄     | 2 clean weeks on beta required before promoting |
| CDN for user assets                                | ⬜     | Vercel Blob or Cloudflare R2                    |
| Public launch (main stable)                        | ⬜     | Blocked on QA gate passing                      |

---

## Phase 7 — Real-time Tools ✅ COMPLETE

| Feature                            | Status |
| ---------------------------------- | ------ |
| Web search (Tavily API)            | ✅     |
| Weather API (OpenWeather)          | ✅     |
| Auto-detected in generate pipeline | ✅     |

---

## Phase 8 — Document Export ✅ COMPLETE

| Feature                       | Status |
| ----------------------------- | ------ |
| PDF export (pdf-lib)          | ✅     |
| Word export (docx)            | ✅     |
| Excel export (xlsx)           | ✅     |
| PowerPoint export (pptxgenjs) | ✅     |

---

## Phase 9 — Music AI ✅ COMPLETE (2026-05-19)

| Feature                                         | Status | Notes |
| ----------------------------------------------- | ------ | ----- |
| AI music generation (FAL.ai models)             | ✅     |       |
| Generated track playback in Studio panel        | ✅     |       |
| Prompt → full music track (vocals, instruments) | ✅     |       |
| Style/genre/mood controls                       | ✅     |       |
| Download generated track                        | ✅     |       |

---

## Phase 10 — Notes Panel ✅ COMPLETE

| Feature                                        | Status |
| ---------------------------------------------- | ------ |
| Rich text editor (Tiptap)                      | ✅     |
| Font, size, bold, italic, underline, highlight | ✅     |
| Tables, code blocks                            | ✅     |
| Drawing canvas                                 | ✅     |
| Cross-device sync (Supabase)                   | ✅     |
| Export: Markdown, HTML, plain text             | ✅     |

---

## Phase 11 — All Panels Upgrade ✅ COMPLETE (2026-05-19)

| Panel        | What shipped                                               |
| ------------ | ---------------------------------------------------------- |
| Editor       | Word wrap, format, copy, download, line/char stats         |
| Preview      | Cancel execution, stderr display, New Tab, real PDF export |
| Video Editor | Full undo/redo, Claude Haiku AI commands                   |
| Music Studio | Solo/mute fix, vocal export via Web Audio                  |
| Image Studio | 30-step undo/redo, text tool, eyedropper, 4-tab panel      |
| Notes        | Export formats, all TypeScript errors fixed                |
| Execute API  | Separate stdout/stderr for all languages                   |

---

## Phase 12 — Observability + Agent System ✅ COMPLETE (2026-05-19)

| Feature                             | Status |
| ----------------------------------- | ------ |
| 8 senior specialist agents          | ✅     |
| Orchestrator + 6 named workflows    | ✅     |
| DECISIONS.md + CHANGELOG.md         | ✅     |
| ESLint + Prettier + CI quality gate | ✅     |
| Sentry error tracking               | ✅     |
| LangFuse LLM pipeline tracing       | ✅     |

---

## Ongoing / Add-ons

| Item                                                  | Status | Notes                                            |
| ----------------------------------------------------- | ------ | ------------------------------------------------ |
| Image generation (FAL.ai)                             | ✅     |                                                  |
| Video generation (FAL.ai)                             | ✅     |                                                  |
| Personality panel                                     | ✅     |                                                  |
| Splash screen + proactive check-in                    | ✅     |                                                  |
| Gallery + sharing                                     | ✅     |                                                  |
| Full Web Audio API (external sources + effects chain) | ✅     |                                                  |
| 3D Studio (Three.js + FAL.ai)                         | ✅     |                                                  |
| Playwright end-to-end tests                           | ✅     |                                                  |
| PostHog user analytics                                | ✅     |                                                  |
| Personal API for developers                           | ⬜     | Expose Based as callable API                     |
| Cross-project referencing (@ProjectName in chat)      | ⬜     | Pull another project's context into current chat |
| Student discount tier ($5/mo)                         | ⬜     | Post-launch, .edu email verify via SheerID       |
