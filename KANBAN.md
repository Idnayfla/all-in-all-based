---
kanban-plugin: board
---

## Loose Ends

- [ ] **L1 Google CSE** — cse.google.com → your engine → Sites to Search → switch to "Search the entire web"
- [ ] **L2 RVC singing** — get `.pth` model → `modal run modal/upload_rvc_model.py --pth your-voice.pth` → `modal deploy modal/rvc_app.py` → set `MODAL_RVC_URL` in Vercel
- [ ] **L3 Google OAuth** — waiting on Google review (~June 14). No action needed.
- [ ] **L4 Supabase vector migration** — run `supabase/migrations/vector_memory.sql` in Supabase Dashboard → SQL Editor (if not done yet)

## Next Up

- [ ] **Link /vote from nav** — Phase 24 board is built but unreachable. Add tab/link in sidebar or header.
- [ ] **BAS-54 Group Chat Phase 1** — observer mode + @mention routing.
- [ ] **Referral backend** — landing page reads `?ref=xxx` → cookie → on signup, write to `referrals` table. Lights up the greyed-out Invite button.
- [ ] **Phase 21 Changelog** — public "you asked, we built it" feed. Closes the community loop.

## Queued

- [ ] **Based for VS Code** — companion + generation + voice in VS Code sidebar. Same backend. Published to Marketplace + Open VSX.
- [ ] **Mac Mini M4 Pro** — trigger: API costs hit S$150+/mo. Qwen2.5 72B local, drop Anthropic for non-generation work.
- [ ] **App Store / Play Store** — blocked on Apple $99/yr + Google $25.

## Shipped ✓

**Complete**

- [x] Multi-model router — Groq → Cerebras → Anthropic fallback chain (`cad869d`)
- [x] Long-term vector memory — Gemini text-embedding-004 + Supabase pgvector (`dba5742`)
- [x] Proactive engine — Based initiates conversations unprompted (`0cd25fe`)
- [x] Ambient vision loop — Gemini 2.0 Flash screen + camera, rolling buffer (`0854726`)
- [x] System control via Electron IPC — type text, volume, open apps, clipboard (`dbf0979`)
- [x] Mood + state inference — typing speed, silence, time of day → tone adjustment (`dbf0979`)
- [x] Multi-language support — user sets language → companion + STT follow
- [x] Mic input profiles — auto-detect external / headset / built-in, RMS thresholds per profile
- [x] Sensor fusion layer — screen + mood + calendar + tasks in every companion request
- [x] BAS-58 Graph hover highlighting — Obsidian-style dim + spotlight
- [x] BAS-53 Founder persona mode — Chief of Staff modifier
- [x] BAS-50 Settings tray — Lang/Mic/VAD behind ⊙ toggle
- [x] Image search — Google CSE + Exa + Wikipedia + DDG fallback chain (`7f4c978`)
- [x] Image search follow-up fix — deterministic planner bypass, no build verbs = search (`7f4c978`)
- [x] Visual mic indicator — waveform / ring / pulse animations in chat panel (`38b86c2`)
- [x] Paste + drag-drop — images and files directly into chat input (`c416c3a`)
- [x] Companion VAD auto-restart — 45-min restart, sliding 20-message context window (`6c82f9b`)
- [x] Companion sliders — debounce + wider proximity range (`41da03e`)
- [x] Deepgram keyword boost — Based:5, Hey:2 (`6c82f9b`)
- [x] RVC singing endpoint — Modal T4 GPU, needs user .pth upload (`76a6c45`)
- [x] Modal F5-TTS voice synthesis
- [x] Discord bot — 18 tools, 60 tests, individual bot identities
- [x] Android live screen + face camera
- [x] Electron companion — loads getbased.dev/companion
- [x] Gemini Flash 2.0 vision — image conversations for free tier (`c71eb28`)

%% kanban:settings

```json
{ "kanban-plugin": "board", "list-collapse": [false, false, false, false] }
```

%%
