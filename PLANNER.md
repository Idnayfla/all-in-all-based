# Based — Product Hunt Launch Plan

**Started:** 2026-06-04  
**Context:** Council revealed only 4 signed-in users in last 30 days. This is a distribution problem, not a conversion problem. Product Hunt is the highest-leverage next move.

---

## What was shipped today (all on main, deployed)

| Feature                                                                         | Commit    |
| ------------------------------------------------------------------------------- | --------- |
| PricingModal overhaul — sharper copy, 6 features, founder note, Free AI reframe | `c292b6d` |
| Pro Welcome Modal — replaces 4-second toast post-Stripe checkout                | `192ae5c` |
| Landing page — pricing section, founder note, updated shipped/coming-next       | `192ae5c` |

---

## Council findings (2026-06-04)

PostHog query results (last 30 days):

- **4 signed-in users** (top of funnel)
- **2 users** ran a generation
- **0 users** hit the 10-build limit
- **2 pro_upgrade_clicked** events (reason: projects + upgrade)

**Verdict:** Pure distribution problem. Nobody knows Based exists. Conversion work was correct but premature. Product Hunt is the move.

Council report: `council-report-2026-06-04.html`  
Council transcript: `council-transcript-2026-06-04.md`

---

## Product Hunt Launch — IN PROGRESS

### Tagline (recommended)

> Your overattached personal AI — builds apps, never leaves your side

### Description

> Based is your personal AI companion — it builds HTML/CSS/JS apps from a single message, edits your video, composes music, generates images, and remembers everything about you across every session.
>
> It runs in your browser, installs as a PWA on mobile, and floats as an always-on-top overlay on Windows — so it's there when you need it, without switching tabs.
>
> Free to try. 10 builds/month on the free tier. Pro is $12/month (founding member price).

### Topics / Tags

- Artificial Intelligence
- Developer Tools
- Productivity
- No-Code
- Design Tools

### First Comment (founder's story — paste within 5 mins of launch)

> Hey PH 👋
>
> I'm Hus — I built Based from Singapore, solo, over the last several months.
>
> The idea started because I was tired of switching between 6 different AI tools to get one thing done. ChatGPT for questions. Cursor for code. Runway for video. Suno for music. Midjourney for images. I wanted one thing that did everything and actually remembered who I was between sessions.
>
> So I built Based.
>
> You describe what you want — an app, a game, a music track, an image — and Based builds it live in a preview panel while you watch. It remembers your style, your past projects, and your preferences. And if you install the Windows companion, it floats on your desktop so it's always one keystroke away.
>
> It's free to try (10 builds/month, no credit card). Pro is $12/month — every subscription directly funds the next feature. I'm building this in public, shaped entirely by the community.
>
> I'd love honest feedback — what's confusing, what's missing, what would make you pay. Happy to answer everything in the comments.
>
> → getbased.dev

### Demo Video Script — 45 seconds

**Tools:** OBS or any screen recorder. No voiceover needed — on-screen text captions carry it.  
**Resolution:** 1920×1080 or 1270×952. No webcam needed.

---

**[0:00–0:04] — Cold open**  
Show getbased.dev landing page for 1 second, then cut directly to the chat panel.  
On-screen text: _"One AI. Apps, music, images — built live."_

**[0:04–0:16] — Live generation (the money shot)**  
Type prompt: `build me a neon particle physics sandbox`  
Let the progress bar fill. Show the code streaming in the right panel.  
Cut to: app loads — particles explode on click.  
On-screen text: _"From message to working app in seconds."_

**[0:16–0:24] — Gallery + Music**  
Quick cut to Gallery: neon snake card, countdown timer card.  
Quick cut to Music Studio: waveform playing, "hip hop beat" visible.  
On-screen text: _"Every creation saved. Music, images, games — all here."_

**[0:24–0:32] — Electron companion**  
Switch to desktop: show the floating overlay pinned over another app.  
Click it — Based pops open instantly.  
On-screen text: _"Always-on-top Windows companion. Never switch tabs again."_

**[0:32–0:40] — Mobile PWA**  
Show iPhone 16 Pro screen: Based open as PWA, conversation visible.  
On-screen text: _"Installs on iPhone and Android. Zero app store."_

**[0:40–0:45] — End card**  
White screen or product screenshot.  
On-screen text (large): **getbased.dev**  
Sub-text: _Free to try · 10 builds/month · No credit card_

---

**Recording tips:**

- Record at 2× speed if needed, then slow to 1× in editor — smooths out typing hesitation
- Use `Ctrl+Shift+P` in OBS to hide cursor during transitions
- Keep captions in Inter or system font, white on dark overlay — matches Based's palette

---

### Screenshots — ALL CAPTURED ✅

1. ✅ Chat → generation mid-progress at 67% (neon particle sandbox)
2. ✅ Electron overlay floating over Based Instagram profile (@based.aistudio)
3. ✅ Gallery page — neon snake + countdown timer + more cards
4. ✅ Music Studio — AI Gen tab with hip hop beat waveform
5. ✅ PricingModal — Free vs Pro, $12 founding price
6. ✅ Mobile PWA — iPhone 16 Pro, real conversation visible

### Launch checklist

**Before launch:**

- [x] Create/claim PH account at producthunt.com — verify email ✅ DONE
- [x] Follow 5-10 active PH hunters ✅ DONE
- [x] Prepare all screenshots at 1270×952px ✅ DONE
- [x] Record 45-second demo video ✅ DONE
- [x] Draft first comment ready to paste ✅ DONE
- [x] Submit product draft — scheduled for June 10, 12:01am PST ✅ DONE

**Launch day:**

- [ ] Post at 12:01am PST (Tuesday or Wednesday)
- [ ] Paste first comment within 5 minutes
- [ ] Share link in SG Tech Founders Telegram + any communities
- [ ] Reply to every comment on launch day

**After launch:**

- [ ] Email existing users — "we just launched on PH, support would mean the world"
- [ ] Watch PostHog for signup spike

---

## How to resume after /clear

Say this:

> "Resume PLANNER.md. We're preparing a Product Hunt launch for Based. All 6 screenshots are done. Next step: record the 45-second demo video. The script is in PLANNER.md."

---

## Content Ideas (post-launch)

- **Video:** AI Companion roasting people — short-form, high virality potential
- **Post:** Cast a vote for social media — community engagement, ties into vote/roadmap feature

## Next after Product Hunt

1. SG Tech Founders Telegram post (warm local leads)
2. Reddit r/SideProject post
3. LinkedIn personal post
4. Pantheon SDK (after traffic established)
