# Based — Decision Log

Significant product, technical, and business decisions. Rationale preserved so future context is never lost.

---

## 2026-05-19 — Comprehensive panel upgrade before stable release

**Decision**: Upgrade all 7 panels (Chat, Editor, Preview, Video, Studio, Image, Notes) to professional-grade feature parity before promoting beta to stable.
**Rationale**: First impression of the stable product must justify the "all-in-one" positioning. Half-finished panels undermine trust.
**Rejected alternatives**: Ship stable with existing panels, iterate post-launch. Rejected because Notes/Video/Image were too incomplete to represent the brand.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Beta → Stable: milestone-gated, not date-gated

**Decision**: Promote `dev` → `main` only when QA release gate passes (2 clean weeks on beta), not on a fixed calendar date.
**Rationale**: A broken stable release is worse than a delayed one. User trust is harder to rebuild than a launch date is to reschedule.
**Rejected alternatives**: 3-month fixed date. Rejected — arbitrary timing doesn't reflect product readiness.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Agent system introduced

**Decision**: Define 8 senior agent roles (Architect, Product, Designer, Growth, QA, DevOps, Security, Chief of Staff) to specialise Claude's behaviour per domain.
**Rationale**: As the product matures, different problems need different expert lenses. A single generalist mode is insufficient for architecture decisions vs copy vs security audits.
**Rejected alternatives**: Single-mode generalist. Rejected — produces mediocre output across all domains.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — Notes panel added (Phase 12)

**Decision**: Add Personal Notes as a first-class panel with rich text (Tiptap), drawing canvas, and Supabase cross-device sync.
**Rationale**: Users expressed need for a persistent workspace beyond generated projects. Notes with drawing fills a gap no competitor addresses in the same product.
**Rejected alternatives**: Third-party embed (Notion, etc.). Rejected — breaks the "all in one" experience.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — Video AI commands via Claude Haiku

**Decision**: Replace regex pattern matching in Video Editor AI bar with real Claude Haiku inference via `/api/video-command`.
**Rationale**: Regex "AI" is a lie. If we call it AI, it must be AI. Haiku is fast and cheap enough for this use case.
**Rejected alternatives**: Keep regex, label it "smart commands". Rejected — brand integrity.
**Owner**: Hus Alfyandi

---

## 2026-05-xx — PDF export via pdf-lib, not browser print dialog

**Decision**: Use pdf-lib + html2canvas for PDF export instead of `window.print()`.
**Rationale**: Browser print dialog is not a download. Users expect a file. pdf-lib gives a real PDF with no browser chrome.
**Rejected alternatives**: `window.print()`. Rejected — poor UX, not a real export.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Audio: OscillatorNode banned for horror/jumpscare apps

**Decision**: Switch to Mixkit CDN `<audio>` elements as the primary audio approach. OscillatorNode now forbidden except for simple UI beeps.
**Rationale**: Generated audio using OscillatorNode was producing corrupted output — raw PCM blobs with a `.mp3` extension — or was completely silent. CDN-hosted audio files are reliable and require no client-side synthesis.
**Rejected alternatives**: Keep OscillatorNode with better prompting. Rejected — structural guarantee requires server-side post-processing, not prompt rules.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Button safety net: exact-word match only + known-ID guard

**Decision**: The injected button safety net now uses exact-word matching (not prefix) and `showGame()` only fires if it recognises at least one of its known screen IDs in the DOM.
**Rationale**: The previous prefix-matching logic was treating `.screen.active` on app-defined screens as a match and removing it, breaking multi-screen apps after a few edits. Exact-word matching and a known-ID guard prevent the safety net from touching DOM it doesn't own.
**Rejected alternatives**: Remove the safety net entirely. Rejected — it prevents too many legitimate button failures in generated apps.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Planner receives 200-char file snippets

**Decision**: The planner now receives the first 200 characters of each existing file when deciding which files to regenerate on a modification request.
**Rationale**: With filenames only, the planner could not distinguish which file contained the relevant code and defaulted to regenerating all files. File snippets allow targeted decisions ("add a button" → only index.html) and reduce unnecessary regeneration.
**Rejected alternatives**: Send full file contents to the planner. Rejected — token cost and latency; 200 chars is sufficient signal for targeting.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Anthropic → Pantheon auto-fallback on errors

**Decision**: Added try-catch around the direct Anthropic path in both `callModel` and `streamText`. Any error (400 out of credits, 429 rate limit, network failure) triggers a silent fallback to Pantheon.
**Rationale**: A 400 or 429 from Anthropic was hard-crashing the entire request. Users saw a broken generation with no recovery. Silent fallback keeps the product working without exposing provider details to users.
**Rejected alternatives**: Surface the error to the user. Rejected — provider failures are infrastructure concerns, not user concerns.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Jumpscare/audio-heavy apps classified as MEDIUM complexity

**Decision**: The planner now explicitly classifies jumpscare and audio-heavy apps as MEDIUM (3 files: index.html + style.css + app.js), not SIMPLE.
**Rationale**: SIMPLE generates a single file. Audio and jumpscare logic requires separation of concerns across HTML, CSS, and JS — collapsing into one file produces unmaintainable output and breaks the audio CDN approach.
**Rejected alternatives**: Keep SIMPLE classification, rely on prompting to split output. Rejected — structural guarantee requires planner-level classification.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Free-user loading messages with animated dots

**Decision**: Add 14 rotating loading messages for free users (cycling every 3200ms), including 3 pro upsell nudges. Animated dots (. .. ...) cycle independently at 450ms.
**Rationale**: Free users face longer wait times. Rotating messages reduce perceived wait and create organic moments to surface the Pro value proposition without a hard paywall interruption.
**Rejected alternatives**: Static "Generating..." spinner. Rejected — misses engagement and upsell opportunity during the highest-attention moment (waiting for output).
**Owner**: Hus Alfyandi

---

## 2026-05-19 — E2B execute route hardened: auth + maxDuration + finally-kill

**Decision**: `/api/execute` now requires authentication, sets `maxDuration=120`, and kills the sandbox in a `finally` block regardless of outcome.
**Rationale**: Without auth, any anonymous caller could spin up E2B sandboxes (billing attack). Without a finally-kill, any exception left the sandbox running and leaking cost. The 120s timeout prevents hanging executions from consuming the Vercel function slot.
**Rejected alternatives**: Only fix the auth. Rejected — a partial fix leaves sandbox leaks open on error paths.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Auth guard added to companion, transcribe, video-command

**Decision**: Three previously unauthenticated API routes now require a valid session token.
**Rationale**: Open inference endpoints expose Anthropic and Groq API credits to anonymous consumption. Any unauthenticated caller could hammer these routes indefinitely.
**Rejected alternatives**: Rate limit only. Rejected — rate limits without auth can be bypassed; auth is the correct first gate.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — debug route gated to non-production

**Decision**: `/api/debug` returns 404 in production (`NODE_ENV === 'production'`).
**Rationale**: The route exposes DB table structure, insert test results, and environment variable presence — all useful for development, all harmful in production.
**Rejected alternatives**: Delete the route. Rejected — still useful locally and in staging.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — LangFuse: span → generation with model + token usage

**Decision**: LangFuse tracing changed from `trace.span()` to `trace.generation()` with `model` name and approximate `input`/`output` token counts (chars / 4).
**Rationale**: `span()` records timing only; `generation()` records model + tokens, enabling LangFuse to calculate per-call cost and show it in the dashboard. Without this, the cost column is always empty.
**Rejected alternatives**: Keep span, add cost tracking externally. Rejected — generation() is the designed API for this; manual workarounds add complexity.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Auto-switch to Preview tab on generation complete

**Decision**: When generation completes with files, the app automatically switches to the Preview tab.
**Rationale**: Users had to manually click Preview after every build. The generated output is the primary result — showing it immediately reduces friction and is the expected behaviour in any IDE-style tool.
**Rejected alternatives**: Leave tab management to the user. Rejected — every single build requires an extra click for no reason.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — sanitizeHTML injects parent-frame override

**Decision**: All generated HTML has a `<script>` injected at the top that overrides `window.parent` and `window.top` to return `window` itself, preventing access to the host frame.
**Rationale**: The preview iframe uses `allow-same-origin` (required for localStorage). With `allow-scripts + allow-same-origin`, a generated app could call `window.parent.document` and read auth tokens from the host. The override neutralises this at the HTML level regardless of sandbox flags.
**Rejected alternatives**: Remove `allow-same-origin`. Rejected — breaks localStorage for generated apps (games with high scores, apps with settings).
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Memory extraction now includes assistant reply

**Decision**: The memory extraction call after each generation now includes the assistant's response in the message array, not just the user messages.
**Rationale**: Memory extraction was operating on a stale closure that excluded the assistant reply. The model had no signal to extract from — it was summarising a half-conversation and often produced no update.
**Rejected alternatives**: Send only user messages. Rejected — the assistant reply contains the key facts worth remembering.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Support nudge fires at build 5/10/15, not build 1

**Decision**: The support/donation nudge now triggers at build count 5, 10, 15... (every 5th build from 5 onwards) instead of triggering on the very first build.
**Rationale**: Showing a donation prompt on build #1 — before the user has experienced any value — is tone-deaf and damages first impressions. By build 5 the user has seen real output and is far more likely to consider supporting.
**Rejected alternatives**: Build #3. Rejected — still too early; #5 is a natural milestone.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Phase 9: Music AI via FAL stable-audio in Studio AI Gen tab

**Decision**: Add an "AI Gen" tab to StudioPanel wired to `/api/music` (Haiku prompt enhancer + `fal-ai/stable-audio`). Gated to Pro tier. Genres, duration picker, `GeneratedMusicCard` list.
**Rationale**: Based is positioned as an "all-in-all" studio — not having AI audio generation while the endpoint already existed was a product gap. The infrastructure was ready; only the UI was missing.
**Rejected alternatives**: New endpoint with a different model. Rejected — `/api/music` already has Haiku enhancer + FAL wired; reusing avoids duplication.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — PostHog analytics: generation, panel, upgrade, identity

**Decision**: Add PostHog via `lib/posthog.ts` singleton + `PostHogProvider` in layout. Track `generation_complete`, `panel_switched`, `pro_upgrade_clicked`, `signed_in`. Requires `NEXT_PUBLIC_POSTHOG_KEY` env var.
**Rationale**: Vercel Analytics shows page views only. To understand which panels users visit, where they drop off, and upgrade conversion, we need event-level analytics. PostHog is open-source compatible and has a generous free tier.
**Rejected alternatives**: Mixpanel, Amplitude. Rejected — PostHog is self-hostable, GDPR-friendly, and has the best free tier for a bootstrapped product.
**Owner**: Hus Alfyandi

---

## 2026-05-19 — Playwright E2E smoke tests, local/staging only

**Decision**: Add Playwright with a 6-test smoke suite covering landing, auth modal, chat input, nav tabs, and error boundary. CI runs quality+build only; E2E runs locally (dev server auto-started) or against staging via `TEST_BASE_URL`.
**Rationale**: End-to-end tests that need real Supabase/Stripe/Anthropic credentials cannot safely run in the public CI environment. Local runner gives the same signal without exposing secrets.
**Rejected alternatives**: Mock all external deps in CI. Rejected — mocked E2E tests don't catch the class of bugs that integration tests exist to find.
**Owner**: Hus Alfyandi
