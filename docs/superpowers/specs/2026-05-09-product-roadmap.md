# All in All Based — Product Roadmap

**Date:** 2026-05-09  
**Status:** Scoping / Not yet started  
**Vision:** Full AI SaaS studio with mobile apps, subscriptions, and public release

---

## Overview

Transform "All in All Based" from a single-user local dev tool into a publicly released, monetised AI studio available on web, Android, and iOS.

---

## Full Feature Scope

### Phase 1 — Auth + Cloud Storage *(Foundation)*
- Email/password account registration and login
- Per-user data isolation (projects, memory, preferences)
- Cloud database replaces localStorage (Supabase or PlanetScale)
- Per-user Redis namespace replaces shared global memory key
- Cross-device sync — log in on any device, data follows you

### Phase 2 — Custom Design System
- Custom typography (premium font pairing)
- Design token overhaul — spacing, radius, shadow, colour scales
- Fluid Framer Motion animations throughout
- Consistent component library (buttons, inputs, cards, modals)
- Dark/light mode with smooth transition

### Phase 3 — Mobile App (Android + iOS)
- Expo / React Native wrapper OR Capacitor shell around existing Next.js app
- Responsive layout for all screen sizes (phone, tablet, desktop)
- Touch-optimised interactions (swipe gestures, bottom sheet navigation)
- Offline-capable shell with graceful degradation

### Phase 4 — App Store + Play Store Publishing
- Apple Developer account ($99/yr required)
- Google Play Developer account ($25 one-time)
- App review compliance (privacy policy, terms of service, content moderation)
- App Store and Play Store listings, screenshots, descriptions
- OTA update pipeline (Expo EAS or CodePush)

### Phase 5 — Subscriptions + Monetisation
- Stripe integration — payment processing, webhooks
- Pricing tiers (e.g. Free / Pro / Studio)
- Feature gating per tier (e.g. video generation, music AI, document export)
- Billing portal (upgrade, downgrade, cancel)
- Trial period support

### Phase 6 — Public Release Infrastructure
- Vercel Pro (or AWS) for production hosting
- CDN, monitoring, error tracking (Sentry)
- Rate limiting per user/tier
- Usage metering (FAL credits, AI tokens per tier)
- Status page

### Phase 7 — Real-Time Data Tools
- Web search integration (Tavily or Brave Search API)
- Weather forecast (OpenWeatherMap or similar)
- Live stock / crypto prices
- News headlines
- Tools injected into Claude API as tool_use calls — Based can call them mid-conversation

### Phase 8 — Document Export
- PDF export (pdf-lib or Puppeteer)
- Word/Docx (docx library)
- Excel/xlsx (xlsx / SheetJS)
- PowerPoint/PPTX (pptxgenjs)
- Triggered from generated content or explicitly requested in chat

### Phase 9 — Music AI
- Suno-style text-to-music generation
- FAL music models (or dedicated music API)
- New "Music" mode in the generation mode dropdown
- Audio player card in chat (similar to GeneratedVideoCard)
- Download generated tracks

### Phase 10 — Memory Tab Redesign
- Per-user memory (unlocked after Phase 1)
- Timeline / history view of extracted memories
- Ability to pin, delete, or edit individual memory entries
- Project-level memory separate and browsable
- Search within memory

---

## Build Order Rationale

| Order | Phase | Why first |
|-------|-------|-----------|
| 1 | Auth + cloud storage | Everything else (subscriptions, mobile, memory) needs real users |
| 2 | Custom design system | Sets visual bar before public release; no throwaway work |
| 3 | Mobile app | Web-first, then wrap; needs auth + design to look right |
| 4 | App Store / Play Store | Requires mobile app to exist |
| 5 | Subscriptions | Needs auth; monetises existing web + mobile users |
| 6 | Public release infra | Needs subscriptions + stable UX before opening to public |
| 7 | Real-time tools | Independent; ships whenever auth is ready |
| 8 | Document export | Independent; high value, low dependency |
| 9 | Music AI | Independent; depends on FAL availability |
| 10 | Memory redesign | Better with per-user data from Phase 1 |

---

## Estimated Timeline

| Phase | Estimated effort |
|-------|----------------|
| 1 — Auth | 1–2 weeks |
| 2 — Design system | 1 week |
| 3 — Mobile app | 2–3 weeks |
| 4 — App stores | 1–2 weeks (+ review time) |
| 5 — Subscriptions | 1 week |
| 6 — Public infra | 1 week |
| 7 — Real-time tools | 3–5 days |
| 8 — Document export | 3–5 days |
| 9 — Music AI | 3–5 days |
| 10 — Memory redesign | 3–5 days |
| **Total** | **~3–4 months full-time** |

---

## Next Step

Begin brainstorming and speccing **Phase 1: Auth + Cloud Storage**.  
All other phases depend on this foundation.
