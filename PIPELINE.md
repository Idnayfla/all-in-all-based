# Based — Build Pipeline

Live reference for what's shipped, what's next, and what's blocked.
Update this as items move.

---

## Loose Ends (quick wins)

| #   | Item                                 | Action                                                                                                                                            | Owner       |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| L1  | **Google CSE — search entire web**   | cse.google.com → your engine → Sites to Search → switch to "Search the entire web"                                                                | Hus         |
| L2  | **RVC singing voice**                | Get a `.pth` model → `modal run modal/upload_rvc_model.py --pth your-voice.pth` → `modal deploy modal/rvc_app.py` → set `MODAL_RVC_URL` in Vercel | Hus + Based |
| L3  | **Google OAuth verification**        | Waiting on Google review (submitted ~June 14). Nothing to do.                                                                                     | Google      |
| L4  | **Supabase vector memory migration** | Run `supabase/migrations/vector_memory.sql` once in Supabase Dashboard → SQL Editor (if not done yet)                                             | Hus         |

---

## Feature Pipeline

### Active — Community & Growth

| Priority | Feature                  | Status  | Notes                                                                                      |
| -------- | ------------------------ | ------- | ------------------------------------------------------------------------------------------ |
| 1        | **Link /vote from nav**  | Next up | Phase 24 board built, unreachable. Add tab in sidebar or header. 10-min job.               |
| 2        | **BAS-54 Group Chat P1** | Next up | Observer mode + @mention routing. Users can pull Based into a group.                       |
| 3        | **Referral backend**     | Next up | `?ref=xxx` → cookie → `referrals` table on signup. Lights up the greyed-out Invite button. |
| 4        | **Phase 21 Changelog**   | Queued  | Public "you asked, we built it" feed. Closes the community loop.                           |

### Platform Expansion

| Priority | Feature                    | Status                           | Notes                                                                                                             |
| -------- | -------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 5        | **Based for VS Code**      | Queued                           | Companion + generation + voice in VS Code sidebar. Same backend, new client. Published to Marketplace + Open VSX. |
| 6        | **Mac Mini M4 Pro**        | Trigger: API costs hit S$150+/mo | Qwen2.5 72B local → drop Anthropic for all non-generation work. Discord bot moves here.                           |
| 7        | **App Store / Play Store** | Blocked                          | Needs Apple $99/yr + Google $25.                                                                                  |

---

## Shipped ✓

| Feature                                           | Commit    | Notes                                                        |
| ------------------------------------------------- | --------- | ------------------------------------------------------------ |
| Multi-model router (Groq → Cerebras → Anthropic)  | `cad869d` | Planner uses Groq free tier                                  |
| Long-term vector memory (Gemini + pgvector)       | `dba5742` | Extracts facts every 5 msgs, semantic recall per query       |
| Proactive engine (Based speaks first)             | `0cd25fe` | Background ticker, time + idle + calendar triggers           |
| Ambient vision loop (screen + camera)             | `0854726` | Gemini 2.0 Flash, rolling buffer, passive background context |
| System control via Electron IPC                   | `dbf0979` | type text, volume, open apps (~80 apps), clipboard           |
| Mood + state inference                            | `dbf0979` | Typing speed, silence, time of day → Based adjusts tone      |
| Image search (Google CSE + Exa + Wikipedia + DDG) | `7f4c978` | Follow-up turns fixed, planner bypass                        |
| Visual mic indicator (waveform / ring / pulse)    | `38b86c2` | Main chat panel                                              |
| Paste + drag-drop images/files into chat          | `c416c3a` | ChatPanel                                                    |
| Companion VAD auto-restart + sliding context      | `6c82f9b` | 45-min restart, last 20 msgs                                 |
| Companion sliders fixed (debounce + wider range)  | `41da03e` | Sensitivity + proximity                                      |
| Deepgram keyword boost (Based:5, Hey:2)           | `6c82f9b` | STT                                                          |
| RVC singing endpoint (Modal T4)                   | `76a6c45` | Needs user to upload .pth                                    |
| Modal F5-TTS voice                                | shipped   |                                                              |
| Discord bot (18 tools, 60 tests)                  | shipped   | Running on desktop                                           |
| Android live screen + face camera                 | shipped   |                                                              |
| Electron companion                                | shipped   | Loads getbased.dev/companion                                 |
| Gemini Flash 2.0 vision (Free AI)                 | `c71eb28` | Image conversations for free tier                            |

---

## How to ship

```
# All changes go to dev first
git checkout dev
# make changes, test with npm run dev in a separate terminal
git push origin dev

# Once confirmed working — merge to main
git checkout main && git merge dev --no-ff && git push origin main
# Vercel auto-deploys on push to main
```
