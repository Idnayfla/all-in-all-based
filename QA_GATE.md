# Based — QA Gate: Beta → Stable

Promotion from `dev` → `main` requires all items below to pass.
Owner: Hus Alfyandi · Updated: 2026-05-20

---

## Hard Gates (must be green before merge)

### CI

- [ ] TypeScript check passes (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier clean (`npm run format:check`)
- [ ] Build succeeds (`npm run build`)

### E2E Smoke (run locally or against beta URL)

- [ ] `npm run test:e2e` — all 6 smoke tests pass
- [ ] Set `TEST_BASE_URL=https://beta.getbased.dev` and re-run against prod environment

### 2-Week Clean-Run on Beta

- [ ] No P0 incidents (generation fails, auth loops, data loss) for 14 consecutive days
- [ ] Sentry: 0 new error classes introduced in the last 7 days
- [ ] Vercel: average function error rate < 1% over 14 days

### Security

- [x] All API routes require auth (execute, companion, transcribe, video-command, publish, share)
- [x] debug route returns 404 in production
- [x] iframe parent-frame override injected in sanitizeHTML
- [x] E2B sandbox killed in finally block
- [x] Run `/security audit` agent — clear sign-off on Stripe webhook, referral, and notes endpoints

### PostHog

- [x] `NEXT_PUBLIC_POSTHOG_KEY` added to Vercel production env vars
- [x] Verify events firing in PostHog dashboard after a test generation

---

## Soft Gates (should be done, not blockers)

### Env Vars

- [ ] All vars in `.env.local.example` are set in Vercel production
- [x] `NETLIFY_TOKEN` set (for publish route)
- [x] `NEXT_PUBLIC_POSTHOG_KEY` set

### Performance

- [ ] Lighthouse score ≥ 70 on landing page (mobile)
- [ ] First generation response < 15s on median (PostHog `generation_complete` latency)

### Content

- [ ] Landing page hero copy reviewed and approved
- [ ] COMING_NEXT items are accurate (no shipped items in that list)
- [ ] PricingModal Pro features list is current

---

## Post-Stable Launch Checklist

- [ ] Push `dev` → `main` via PR (not force push)
- [ ] Tag the release: `git tag v1.0.0`
- [ ] Announce on X/Twitter and ProductHunt
- [ ] Growth agent: write ProductHunt launch copy
- [ ] Monitor PostHog for first-hour drop-off
- [ ] Monitor Sentry for any new error classes in first 24h

---

## Roadmap Beyond Stable

| Phase    | Feature                     | Status                           |
| -------- | --------------------------- | -------------------------------- |
| Phase 9  | Music AI                    | ✅ shipped                       |
| —        | PostHog analytics           | ✅ shipped                       |
| —        | Playwright E2E              | ✅ shipped                       |
| Phase 6  | Stable launch               | ← you are here                   |
| Phase 10 | Personal API for developers | queued                           |
| Phase 11 | Team Workspaces             | queued                           |
| Phase 12 | Based Model (fine-tuned)    | queued (needs ~500 paying users) |
