# Google Play Store Listing — Based

Paste-ready copy + asset specs for the Play Console submission.
Brand rules: companion angle (NOT "app builder"), no emoji, human tone.

---

## App title (max 30 chars)

```
Based — AI Companion
```

## Short description (max 80 chars)

```
Your personal AI companion — on your screen, in your corner, every day.
```

## Full description (max 4000 chars)

```
Based isn't another chatbot you open and close. It's a companion that actually lives with you — floating on your screen, remembering what matters, and ready the moment you need it.

Ask it anything. Talk to it. Show it your screen and it sees what you're working on. It remembers your projects, your tasks, and the things you told it last week — so you're never starting from scratch.

What Based does:
- Voice conversations — open the companion and just talk
- Sees your screen when you share it, so it understands your context
- Remembers your tasks, notes, and projects across every device
- Connects to your Google Calendar so it knows your day
- Builds apps, images, music, and more when you ask — live, in front of you
- A floating companion that's one tap away

Built for people who want a real assistant, not a search box. Based keeps you in check, picks up where you left off, and feels less like a tool and more like someone in your corner.

Free to start. Pro unlocks unlimited use.
```

### Claim accuracy notes (read before publishing)

- **Voice**: works while the companion is open/foreground only. Do NOT claim "Hey Based" hands-free or lockscreen listening — that needs a native microphone foreground service + on-device wake word (not shipped). Overclaiming triggers Play removal.
- **Screen sharing**: works (MediaProjection, single-shot when user taps share).
- **Calendar**: works (OAuth via Custom Tab + App Link).
- Trim any bullet whose feature isn't solid on the Android build before submitting.

---

## Required assets

| Asset                            | Spec                                              | Status                                    |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| App icon                         | 512×512 PNG, 32-bit                               | have (`ic_launcher`) — export 512 version |
| Feature graphic                  | 1024×500 PNG/JPG, no transparency                 | NEEDED                                    |
| Phone screenshots                | 2–8 images, min 320px side, 16:9 or 9:16, PNG/JPG | NEEDED                                    |
| (optional) 7" / 10" tablet shots | —                                                 | optional                                  |

### Feature graphic (1024×500) — content idea

Dark background (#0a0a0f), the Based bubble/mark, headline "Not a chatbot. A companion." in the gold gradient. No screenshot inside it. Keep text away from edges (Play overlays a play button center-ish on some surfaces).

### Screenshots to capture (phone, on-device)

1. The companion floating bubble over the home screen / another app (the signature shot)
2. A live voice or chat conversation
3. The companion seeing/responding about a shared screen
4. Tasks + calendar view (the "knows your day" angle)
5. A generated app/image in the live preview
   Capture at the phone's native resolution. Use a clean status bar (full battery, no clutter — enable demo mode if you want).

---

## Data Safety form (Play Console) — declare these

Collected/used (must match privacy policy at getbased.dev/privacy):

- Email (account)
- Camera, Microphone — for voice/vision features; processed for the request, not stored
- Approximate location — location-aware answers (weather)
- Screen content (MediaProjection) — only when user shares; not stored
- Usage/diagnostics (PostHog, anonymised)
  Account deletion: YES — in-app (Settings → Delete account) + email fallback.

## Sensitive permission justification (Console will ask)

- SYSTEM_ALERT_WINDOW (overlay): the floating companion bubble that lets users reach Based from any screen.
- MediaProjection (screen capture): so the companion can see what the user is looking at — only on explicit tap, single frame, not recorded.

## Billing model (Option A — gated, not Play Billing)

Based does NOT sell digital subscriptions inside the Android app. The in-app
purchase CTA is hidden (native WebView UA marker → web hides the checkout button,
shows "upgrade on getbased.dev"). Users subscribe on the web; entitlement is
server-side, so Pro works in the app for web purchasers. No non-Play billing is
initiated in-app. (If full in-app purchasing is wanted later, integrate Google
Play Billing — Option B.)

## App access / Reviewer notes (paste into Play Console "App access")

The app requires sign-in. Provide a test account so the reviewer can access all features:

```
Reviewer notes:
Based is a personal AI companion. Sign in with the test account below
(or "Continue with Google"). The floating bubble requires the "Display over
other apps" permission — tap Allow when prompted.

Subscriptions: Pro is sold only on our website (getbased.dev), not inside the
app. The app shows a "manage on web" note instead of a purchase flow, so no
non-Google-Play billing occurs in the app. Free features are fully usable
without subscribing.

Test account:  <CREATE A TEST EMAIL + PASSWORD AND PUT IT HERE>
```

## Release build

- `android/app/build.gradle`: versionCode 1, versionName "1.0", targetSdk 35 — release-ready.
- Build a signed AAB in Android Studio (Build → Generate Signed Bundle). Use Play App Signing.
- After creating the app in Play Console, copy the Play App Signing SHA-256 into
  `public/.well-known/assetlinks.json` (second fingerprint) and redeploy, or the App Link / OAuth breaks in the Play-signed build.
- Upload to the Internal testing track first; promote to Production after QA.
