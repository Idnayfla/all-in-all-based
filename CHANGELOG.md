Based — Changelog

User-facing record of what shipped on beta.getbased.dev.

---

## [Beta] 2026-05-19 — Generation Engine Reliability

### Added

- **Rotating loading messages** for free users — 14 messages cycle every 3.2s with animated dots, including Pro upsell nudges during the wait
- **Real audio from Mixkit CDN** — horror, jumpscare, and audio-heavy apps now use hosted audio files instead of synthesized browser beeps; audio is reliable across all browsers

### Fixed

- **Small edits no longer regenerate the whole project** — the planner now reads the first 200 characters of each file and targets only the file that needs changing (e.g. "add a button" touches index.html only)
- **App buttons no longer break after a few edits** — the button safety net now uses exact-word matching and only activates when it recognises its own screen IDs, so it cannot remove `.active` from screens it doesn't own
- **Seamless AI provider fallback** — if the primary AI provider returns a credit or rate-limit error, generation automatically retries via the secondary provider with no interruption to the user

---

## [Beta] 2026-05-19 — All Panels Upgrade

### Added

- **Editor**: Word wrap toggle, one-click format, copy to clipboard, download file, live line and character count
- **Preview**: Cancel running code mid-execution, errors shown separately in red, open preview in a new browser tab, real PDF export (downloads a file, not a print dialog)
- **Video Editor**: Full undo/redo including trim and speed changes, AI command bar powered by Claude — type plain English to edit your video
- **Image Studio**: 30-step undo/redo, text tool (click to place text on canvas), colour eyedropper, 4-tab panel (Tools / Layers / Filters / AI)
- **Music Studio**: Solo button now correctly mutes all other tracks, vocal and audio track export now captured in the mix
- **Notes**: Export your notes as Markdown, HTML, or plain text

### Fixed

- Studio solo/mute logic was ignoring soloed state — now works correctly
- PDF export was opening a print dialog instead of downloading
- Notes tab was being clipped on smaller screens — tab bar now scrolls
- Code errors (stderr) now shown separately from output, in red

---

## [Beta] 2026-05-19 — Phase 9: AI Music Generation

### Added

- **AI Gen tab in Studio** — describe a track, pick a genre and duration, get a real audio file. Powered by FAL stable-audio with Haiku prompt enhancement
- **10 genre chips** — Cinematic, Lo-fi, Electronic, Ambient, Jazz, Rock, Orchestral, Chill, Epic, Dark
- **Duration presets** — 15s, 30s (default), 45s, 60s
- Tracks appear in a card list with playback — Pro tier only

---

## [Beta] 2026-05-xx — Personal Notes (Phase 12)

### Added

- Notes panel: rich text editing with font, size, bold, italic, underline, highlight, tables, code blocks
- Drawing canvas inside notes — sketch directly in your note
- Notes sync across devices via your Based account
- Export notes as Markdown, HTML, or plain text

---

## [Beta] Earlier — Core Platform

### Added

- Chat with Based (Claude-powered), generates HTML/CSS/JS apps live
- Live Preview panel with iframe render
- Code Editor (Monaco) synced with generated output
- Music Studio with drum sequencer and audio tracks
- Image Studio with layers and filters
- Video Editor with trim, speed, text overlays
- Proactive check-in: "You were working on X, continue?"
- User memory across sessions (remembers your projects and preferences)
- Pro subscription tier with higher generation limits
