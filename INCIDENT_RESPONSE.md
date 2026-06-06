# INCIDENT_RESPONSE.md — Based (getbased.dev)

> The document you reach for at 3am on Product Hunt launch day when your phone is blowing up.
> Solo operator: Hus. Timezone: SGT (UTC+8). Keep calm. Stop the bleeding first, diagnose second.

**Golden rules during an incident:**

1. **Stop the bleeding before you understand the cause.** Disable the abused thing, then investigate.
2. **One change at a time.** Don't shotgun fixes during a spike — you won't know what worked.
3. **Rollback is faster than a fix.** If a deploy broke prod, revert first, debug later.
4. **Cost incidents are silent.** No alert fires until money is gone. Check spend dashboards proactively on launch day.
5. **Write down what you did** in a scratchpad as you go — you'll need it for the post-mortem and to undo mistakes.

---

## FIRST RESPONDER CHECKLIST (you don't know what's wrong yet)

Run this top-to-bottom. ~3 minutes total.

1. **Is it actually down for everyone, or just you?**
   - Open https://getbased.dev in an incognito window + on mobile data (not wifi).
   - Check https://downforeveryoneorjustme.com/getbased.dev
   - If it loads for you → it's user-side or regional. Don't panic-deploy.

2. **Check the platform status pages** (see Status Pages section). Vercel and Supabase incidents are not your fault and not your fix — confirm before you start debugging your own code.

3. **Check Vercel deployments** → https://vercel.com/dashboard
   - Did a deploy land in the last 30 min? If the latest deploy is "Error" or the timing lines up with the breakage → **ROLLBACK** (see Scenario 7). Don't debug a bad deploy under pressure.

4. **Check Sentry** → https://sentry.io → Issues, sort by "Last seen" / "Events" (24h).
   - A spike of one error type tells you the layer: `getUser`/JWT → auth; `ECONNREFUSED`/`redis` → Redis; `overloaded_error`/`429` → Anthropic; `5xx` from `supabaseAdmin` → Supabase.

5. **Check the money** → Anthropic console + Stripe + ElevenLabs. A traffic spike that is _abuse_ looks identical to _success_ until you look at cost-per-user. (Scenarios 8–13.)

6. **Check PostHog live events** → https://us.posthog.com → Activity / Live events. Is traffic real users or one IP/account hammering one endpoint?

7. **Triage the layer** using this decision tree:
   - Site fully down + Vercel status red → **wait + comms** (Scenario 1).
   - Site fully down + Vercel status green → **rollback last deploy** (Scenario 7), then investigate.
   - Login broken, rest works → **Supabase auth** (Scenario 4).
   - Generation broken, rest works → **Anthropic / fallback chain** (Scenario 3).
   - Everything slow, nothing down → **cold starts / timeouts** (Scenario 6).
   - Costs spiking → **abuse playbook** (Scenarios 8–13).

8. **Post a holding message** if it's user-visible and lasts >5 min (Scenario 26).

---

## STATUS PAGES (bookmark all of these)

| Service        | Status URL                                               |
| -------------- | -------------------------------------------------------- |
| Vercel         | https://www.vercel-status.com                            |
| Supabase       | https://status.supabase.com                              |
| Anthropic      | https://status.anthropic.com                             |
| Stripe         | https://status.stripe.com                                |
| Upstash/Redis  | https://status.upstash.com                               |
| Groq           | https://groqstatus.com                                   |
| Cerebras       | https://status.cerebras.ai (or their X/@CerebrasSystems) |
| ElevenLabs     | https://status.elevenlabs.io                             |
| Modal          | https://status.modal.com                                 |
| GitHub         | https://www.githubstatus.com                             |
| Resend         | https://resend-status.com                                |
| PostHog        | https://status.posthog.com                               |
| Sentry         | https://status.sentry.io                                 |
| Cloudflare DNS | https://www.cloudflarestatus.com                         |
| Higgsfield     | check https://higgsfield.ai or their X                   |
| E2B            | https://status.e2b.dev                                   |

**Operator dashboards (your control panels):**

| Thing             | URL                                                       |
| ----------------- | --------------------------------------------------------- |
| Vercel project    | https://vercel.com/dashboard                              |
| Vercel logs       | https://vercel.com/<team>/<project>/logs                  |
| Vercel firewall   | https://vercel.com/<team>/<project>/firewall              |
| Supabase project  | https://supabase.com/dashboard/project/_                  |
| Supabase SQL      | https://supabase.com/dashboard/project/_/sql/new          |
| Supabase logs     | https://supabase.com/dashboard/project/_/logs/explorer    |
| Supabase auth     | https://supabase.com/dashboard/project/_/auth/users       |
| Supabase backups  | https://supabase.com/dashboard/project/_/database/backups |
| Anthropic console | https://console.anthropic.com/settings/usage              |
| Anthropic keys    | https://console.anthropic.com/settings/keys               |
| Stripe dashboard  | https://dashboard.stripe.com                              |
| Stripe webhooks   | https://dashboard.stripe.com/webhooks                     |
| Stripe Radar      | https://dashboard.stripe.com/radar                        |
| Upstash console   | https://console.upstash.com                               |
| ElevenLabs usage  | https://elevenlabs.io/app/usage                           |
| PostHog           | https://us.posthog.com                                    |
| Sentry            | https://sentry.io                                         |
| GitHub repo       | https://github.com/<you>/all-in-all-based                 |

---

## SETUP YOU SHOULD DO **BEFORE** LAUNCH (do this now, not at 3am)

```bash
# Install Vercel CLI — you will need this to rollback and tail logs fast.
npm i -g vercel
vercel login
vercel link          # run inside the repo, links to the prod project

# Install Stripe CLI — for replaying failed webhooks.
# macOS: brew install stripe/stripe-cli/stripe   |  Windows: scoop install stripe
stripe login

# Confirm you can reach Redis directly. REDIS_URL is in Vercel env.
# The app uses node-redis over REDIS_URL (NOT the Upstash REST API).
# redis-cli works if it's a standard redis:// URL:
redis-cli -u "$REDIS_URL" PING     # expect PONG
```

Pull prod env vars locally once so you have them when you need to rotate or query:

```bash
vercel env pull .env.incident      # gitignored — DELETE after the incident
```

---

# AVAILABILITY

## 1. Users can't connect / site appears down

**Detection signals:** "site is down" DMs, Vercel deployment shows healthy but pages 5xx/timeout, Sentry quiet (because the platform never reaches your code) or Sentry flooded.

**Immediate response (first 5 min):**

- Load https://getbased.dev incognito + on mobile data. If it loads for you, it's regional/user-side — see Scenario 2.
- Check https://www.vercel-status.com and https://status.supabase.com. **If either is red, it's not your code.** Jump to comms (Scenario 26) and wait.
- Check Vercel deployments. If a deploy landed near the breakage → ROLLBACK (Scenario 7).
- DNS check:
  ```bash
  nslookup getbased.dev
  dig getbased.dev +short        # should resolve to Vercel's anycast IPs (76.76.21.x range)
  ```
  If DNS doesn't resolve → registrar/DNS issue, not Vercel app issue. Check your domain provider + Cloudflare status.

**Containment:**

- Platform outage → nothing to fix, post holding message, monitor status page.
- Bad deploy → rollback.
- DNS → verify the domain isn't expired (yes, really, check the registrar) and the Vercel domain assignment is intact at Vercel → Project → Settings → Domains.

**Recovery:** Once root layer is healed, hard-refresh and verify login + one generation end-to-end yourself before announcing "we're back."

**Post-mortem fix:** Add an uptime monitor (UptimeRobot / Better Stack, free tier) hitting `https://getbased.dev/api/heartbeat` every minute so you find out before users DM you.

---

## 2. Partial outage (some users fine, others not)

**Detection signals:** Mixed reports. Some regions/devices work. Sentry errors cluster by region or by a single browser/OS.

**Immediate response:**

- In PostHog, group recent errors/events by `$geoip_country` and `$browser`. A single-region cluster = Vercel edge region or Supabase read-replica issue.
- Check Vercel status for region-specific notices.
- Supabase: if reads are stale/failing for some users but writes work, suspect replica lag — check Supabase → Database → Replication and the logs explorer.

**Containment:** Region-specific Vercel issue → nothing you can do but wait; reassure affected users it's regional. Replica lag → it self-heals; if a query depends on a read that lags, you can't fix it live — note it.

**Recovery:** Confirm the affected region/browser recovers. Ask one affected user to retry.

**Post-mortem fix:** Avoid read-after-write across replicas for critical paths (read your own writes from primary). Add region dimension to your uptime monitor.

---

## 3. AI generation failing (Anthropic down / overloaded)

**Detection signals:** Sentry shows `overloaded_error`, `rate_limit_error`, or `529`/`429` from Anthropic. Users report "Based is a bit overloaded" messages. Generation spinner hangs or errors. Site otherwise fine.

**Fallback chain (how it already behaves):** The planner step tries **Groq → Cerebras → Haiku**. The _file generator_ and chat use **Anthropic (Opus/Sonnet)** with no model fallback — so if Anthropic is down, **generation is down even though the planner still works.** Free-model users (`aiModel: 'free'`) hit Groq directly.

**Immediate response:**

- Check https://status.anthropic.com. If red → it's upstream; post comms; nothing to deploy.
- Check https://console.anthropic.com/settings/usage — are you actually rate-limited (your own per-minute cap) vs. Anthropic-wide overload? If it's _your_ org rate limit, you're being hammered → go to Scenario 8.

**Containment:**

- If Anthropic is overloaded org-wide and you must stay up: the cheapest live mitigation is to push everyone to the free/Groq path. There's no env flag for that today — fastest lever is to set `ALWAYS_PRO` aside and accept degraded service, OR ship a one-line change forcing the generator model to Sonnet (cheaper, sometimes less throttled than Opus). Only do this if the outage is sustained.
- If it's your own per-minute org limit from a traffic spike, throttle the abuser (Scenario 8), not all users.

**Recovery:** Anthropic recovers → generation resumes automatically, no action needed. Verify with one real prompt.

**Post-mortem fix:** Add an Anthropic-failure fallback to Sonnet (or a queued retry with backoff) in the file generator so a single-model outage doesn't take generation fully down. Surface a clear "AI provider degraded, retry shortly" toast instead of a hung spinner.

---

## 4. Supabase auth down (nobody can log in)

**Detection signals:** Login/signup fail, existing sessions may still work (JWTs are valid until expiry). Sentry: errors from `auth.getUser`, `/auth/v1/token`. Generation 401s because `getUserId()` throws.

> **Critical dependency:** `getUserId()` calls `supabaseAdmin.auth.getUser(token)` on _every_ generate request. If Supabase auth is down, **even logged-in users can't generate** because token verification fails server-side.

**Immediate response:**

- Check https://status.supabase.com. If red → upstream, comms, wait.
- If green but auth still fails → check your Supabase project isn't paused (free/pro project pausing) or over a connection limit: Supabase → Project → Database → check connection count and project status.

**Containment:**

- If it's a Supabase platform outage: there is no failover. Post comms ("login is temporarily unavailable, working on it"). Don't burn time trying to "fix" their infra.
- If it's a connection-pool exhaustion (likely during a spike, because every generate call verifies the token): this is _your_ load. Reduce it — throttle abusers, and consider that `getUser` per-request is a bottleneck. Emergency lever: there isn't a clean one live; note it for post-mortem.

**Recovery:** Auth restored → logins work. Verify signup + login + generate yourself.

**Post-mortem fix:** **This is the scariest single point of failure for launch.** Cache token verification (verify the JWT signature locally with the project JWT secret instead of calling `auth.getUser` on every request) so a Supabase auth blip or connection-limit doesn't take down generation. This removes an Anthropic-spike-amplifying round-trip too.

---

## 5. Redis (Upstash) down

**Detection signals:** Sentry: `ECONNREFUSED`/redis connection errors (should be swallowed). Generation rate limiting silently stops working. TTS slower (cache misses). Upstash status red.

**Risk profile:** **Rate limiting fails OPEN by design** (see `app/api/generate/route.ts` — the `catch` block comment: "fail open — never block users due to Redis issues"). So Redis down means **the 10-req/min/user generation cap is gone.** During a normal day this is fine. **During a Product Hunt spike + abuse, this is dangerous** — the abuse brake is off, and only the per-month free-tier DB counter (10 generations) protects you. TTS just loses its cache (more ElevenLabs/Modal calls).

**Immediate response:**

- Confirm Upstash status + console (https://console.upstash.com). Check the DB isn't over its request/bandwidth limit (free tier caps).
- `redis-cli -u "$REDIS_URL" PING` — no PONG = it's really down.

**Containment:**

- Redis down is non-fatal for availability but removes your abuse brake. **Watch Anthropic + ElevenLabs spend closely while Redis is down.** If abuse appears, fall back to banning accounts directly in Supabase (Scenario 8/13) since IP/rate limiting is gone.
- If it's an Upstash quota cap, upgrade the plan in console (instant) — cheaper than an abuse bill.

**Recovery:** Redis returns → singleton reconnects on next request (the client nulls itself on error and recreates). No deploy needed.

**Post-mortem fix:** Add a secondary cheap brake that doesn't depend on Redis (e.g., short-window in-memory counter per warm instance, or tighten the free-tier DB counter). Alert when Redis error rate > 0 so you know the brake is off.

---

## 6. Slow but not down (cold starts, timeouts, high latency)

**Detection signals:** Pages/generation slow, intermittent timeouts, Sentry shows function execution time near the limit, Vercel logs show `Function Timeout`. No hard errors.

**Immediate response:**

- Vercel → Logs / Observability: check function duration p95/p99 and which route is slow.
  ```bash
  vercel logs --follow            # tail live; or use the dashboard Observability tab
  ```
- Distinguish causes:
  - **Anthropic latency** (Opus is slow under load) → upstream, see Scenario 3.
  - **Supabase slow queries** → check Supabase logs explorer for slow queries; the `auth.getUser` per-request + `user_settings` lookups add up under load.
  - **Cold starts** → Fluid Compute reduces these but a sudden 50x spike still spins new instances.

**Containment:** If a specific slow query is the culprit, that needs a code/index fix — not live-fixable safely under load; note it. If it's Anthropic, no action. If it's Supabase connection pressure, throttle abusers to shed load.

**Recovery:** Latency normalizes as the spike settles or upstream recovers.

**Post-mortem fix:** Add indexes on hot columns (`user_settings.user_id` PK, `projects.user_id, created_at`, `feature_votes.request_id`). Cache JWT verification (Scenario 4 fix) to cut a round-trip off every generate. Consider keeping the generate function warm during launch window.

---

## 7. Vercel build failing / bad deploy broke prod — ROLLBACK IN UNDER 2 MIN

**Detection signals:** Latest Vercel deployment "Error", OR build succeeded but prod is broken and the timing matches your last push. Sentry error spike starting exactly at deploy time.

**Immediate response — ROLLBACK NOW, debug later:**

**Fastest (dashboard, ~30s):**

1. https://vercel.com/dashboard → your project → **Deployments**.
2. Find the last known-good deployment (green, before the breakage).
3. Click the `...` menu → **Promote to Production** (a.k.a. "Instant Rollback"). Prod traffic shifts immediately, no rebuild.

**CLI alternative:**

```bash
vercel ls                                  # list recent deployments, find a good one
vercel rollback                            # rollback to the previous production deployment
# or pin a specific one:
vercel promote <deployment-url>            # promote a known-good deployment to prod
```

**Containment:** Once rolled back, prod is on good code. **Do not re-push to main** until you've reproduced and fixed the bug on `dev` (and locally — never run the dev server in this repo; use `npm run check`).

**Recovery:** Verify the rolled-back prod works (login + generate). Then fix forward on `dev`, run `npm run check`, and merge to main only when confirmed.

**Post-mortem fix:** Trust the CI gate (`.github/workflows/ci.yml`: typecheck → lint → prettier → build). Don't merge to main while distracted on launch day. Consider a Vercel preview/staging smoke test before promoting.

---

# COST / ABUSE

> Cost incidents don't page you. **On launch day, eyeball Anthropic + ElevenLabs spend every ~30 min.** Anthropic alert is set at $50 warn / $200 hard stop — but $200 can burn in an hour under abuse.

## 8. Anthropic token spam — someone hammering /api/generate

**Detection signals:** Anthropic usage graph (https://console.anthropic.com/settings/usage) climbing steeply. PostHog shows one `user_id`/IP with a huge generation count. Your per-minute org rate limit getting hit (legit users see "overloaded").

**Immediate response (first 5 min):**

1. Identify the abuser. In Supabase SQL (https://supabase.com/dashboard/project/_/sql/new):
   ```sql
   -- Top generators in the last hour
   SELECT user_id, COUNT(*) AS builds
   FROM projects
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY user_id
   ORDER BY builds DESC
   LIMIT 20;
   ```
   (Note: `projects` only counts _saved_ builds. A spammer hitting `/api/generate` without saving won't show here — cross-check PostHog live events and Vercel logs for `/api/generate` by IP/user.)
2. Ban the user immediately (kills their token + future logins):
   ```sql
   UPDATE auth.users SET banned_until = 'infinity' WHERE id = '<user-id>';
   ```
   A banned user's existing JWT will fail `auth.getUser` → 401 on next generate. Effect is near-instant.

**Containment:**

- Multiple accounts? Ban them all in one statement:
  ```sql
  UPDATE auth.users SET banned_until = 'infinity'
  WHERE id IN ('<id1>','<id2>','<id3>');
  ```
- If it's one IP across many accounts, block the IP at the edge — **Vercel Firewall** (https://vercel.com/<team>/<project>/firewall): add an IP block rule, or flip on **Attack Challenge Mode** for a blanket challenge during a flood.
  ```bash
  # Vercel firewall via CLI (after `npm i -g vercel`)
  vercel firewall                            # inspect; manage rules in dashboard for speed
  ```
- **Nuclear option — kill all generation:** if you can't stop the spend any other way, rotate/disable the Anthropic key so generation 500s for everyone (better than a runaway bill):
  - https://console.anthropic.com/settings/keys → revoke the key.
  - This takes down generation site-wide. Use only if spend is out of control and you can't pin the abuser. Post comms (Scenario 26, sev-high).

**Recovery:** Abuser banned / IP blocked → spend curve flattens. Re-enable the key if you killed it. Verify a legit generation works.

**Post-mortem fix:** The Redis 10/min cap helped but Redis fails open. Add: (a) a hard per-user _daily_ generation ceiling in the DB (not just monthly free-tier), (b) a global circuit breaker that pauses generation if org spend velocity exceeds a threshold, (c) alert on Anthropic spend rate, not just total.

---

## 9. ElevenLabs credit drain (coordinated TTS spam)

**Detection signals:** ElevenLabs usage (https://elevenlabs.io/app/usage) dropping fast / credits draining. TTS endpoint traffic spike in Vercel logs. Note: TTS now requires auth (recent hardening), so a drain means _authenticated_ accounts are doing it.

**Immediate response:**

- TTS routes (`/api/tts`, warmup, keepalive) are auth-gated now. Find which users are hammering TTS via Vercel logs (filter path `/api/tts`) and PostHog.
- Ban those users (same SQL as Scenario 8).
- TTS caches by `tts:<gender>:<hash>` in Redis — repeated identical text is cheap (cache hit). A drain implies _varied_ text → likely scripted abuse.

**Containment:**

- Ban abusers. If widespread, temporarily disable TTS: rotate the `ELEVENLABS_API_KEY` in Vercel env (TTS will fail gracefully / fall back to Modal F5-TTS). Modal is your own GPU — drain there costs Modal compute, not ElevenLabs credits, but still costs money; watch Modal too (https://status.modal.com / Modal dashboard).

**Recovery:** Abusers banned, key restored. Verify TTS plays.

**Post-mortem fix:** Add per-user TTS rate limit + monthly character cap (mirroring the media limits in `_mediaRateLimit.ts`). Cap max text length harder. Alert on ElevenLabs credit burn rate.

---

## 10. E2B sandbox abuse (expensive sandboxes on repeat)

**Detection signals:** E2B usage/billing climbing (https://status.e2b.dev for outages; E2B dashboard for usage). `/api/execute` traffic spike. Sandboxes spawning faster than users could plausibly need.

**Immediate response:**

- `/api/execute` has per-user rate limiting (recent hardening) but limit-hit users can still burn cost up to the cap. Find heavy executors via Vercel logs (path `/api/execute`) + PostHog, ban them (Scenario 8 SQL).

**Containment:**

- Disable code execution if the drain is bad: rotate/clear the E2B API key in Vercel env so `/api/execute` fails closed. Execution dies for everyone; preview/generation still works.
- Block offending IPs in Vercel Firewall.

**Recovery:** Restore key after banning abusers. Verify one execute works.

**Post-mortem fix:** Tighten per-user execute rate limit + add a daily cap. Ensure sandboxes have short timeouts and are torn down. Alert on E2B spend.

---

## 11. Multi-account farming (50 free accounts in an hour, all building)

**Detection signals:** Burst of new signups in a short window, many low-activity accounts each consuming free generations. PostHog signup funnel spikes abnormally.

**Immediate response:**

```sql
-- Suspicious new accounts in the last hour
SELECT id, email, created_at, raw_user_meta_data->>'provider' AS provider
FROM auth.users
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

Look for patterns: same email domain, `user+1@`, `user+2@` Gmail aliases, sequential timing, same IP.

```sql
-- Group new accounts by email domain to spot farming
SELECT split_part(email, '@', 2) AS domain, COUNT(*)
FROM auth.users
WHERE created_at > NOW() - INTERVAL '2 hours'
GROUP BY domain
ORDER BY count DESC;
```

**Containment:**

- Mass-ban the farm:
  ```sql
  UPDATE auth.users SET banned_until = 'infinity'
  WHERE created_at > NOW() - INTERVAL '1 hour'
    AND email LIKE '%@suspectdomain.com';
  ```
  (Inspect with a SELECT first — never run a blind mass UPDATE on `auth.users`.)
- Block the source IP/range in Vercel Firewall.
- If signups are flooding, enable Supabase **email confirmation required** (Auth → Providers → Email → "Confirm email") so throwaway accounts can't immediately generate. Note: this adds friction for _legit_ launch-day signups — weigh it.

**Recovery:** Farm banned, IP blocked. Legit signups continue.

**Post-mortem fix:** Add signup velocity limits, block disposable-email domains, consider Gmail-alias (`+`) normalization, and CAPTCHA on signup (Supabase supports hCaptcha/Turnstile in Auth settings).

---

## 12. Groq/Cerebras free tier exhausted → everything falls back to paid Anthropic

**Detection signals:** Planner latency jumps (Haiku slower than Groq's ~450ms). Sentry: Groq `429`/"daily limit", Cerebras "rate limited". Anthropic usage rises because the planner now uses Haiku (paid) instead of free Groq.

**How it behaves:** Planner chain is Groq → Cerebras → Haiku. When both free tiers exhaust, the planner runs on Haiku (cheap but paid). The big cost is still the _generator_ (Opus/Sonnet) — exhausting free planners adds modest cost, not catastrophic. Free-model _users_ (`aiModel: 'free'`) lose Groq and get the "Free AI daily limit reached — switch to Based AI or try again tomorrow" error.

**Immediate response:**

- Confirm via Groq console (rate-limit headers) and Cerebras dashboard. This is usually self-resolving (daily reset) and low-cost — don't over-react.
- Verify it's _only_ the planner cost rising and not a generator-level Anthropic spike (Scenario 8).

**Containment:** None urgent. If free-model users complain, that's expected behavior on free-tier exhaustion. If you want to keep free planning, add a `CEREBRAS_API_KEY` (per memory it's not yet set in Vercel env — adding it enables the second free tier, ~1M tokens/day).

**Recovery:** Free tiers reset daily (Groq/Cerebras). Set `CEREBRAS_API_KEY` to widen the free buffer.

**Post-mortem fix:** Add a third free planner fallback or self-host a small planner model (the "Based model" plan). Alert when planner fallback rate to Haiku exceeds X%.

---

# SECURITY BREACH

## 13. Token spam happening RIGHT NOW — emergency playbook

**You're watching it live:** PostHog live events flooding, Anthropic spend ticking up in real time.

**Do this in order, fast:**

1. **Find the attacker.** Vercel logs filtered to `/api/generate` (look at IP + Authorization-derived user) + the top-generators SQL (Scenario 8). PostHog → Live events, group by `distinct_id`/IP.

2. **Ban the account(s):**

   ```sql
   UPDATE auth.users SET banned_until = 'infinity' WHERE id = '<user-id>';
   -- or many:
   UPDATE auth.users SET banned_until = 'infinity' WHERE id IN ('<id1>','<id2>');
   ```

   The next `auth.getUser` call for their token fails → 401. No deploy needed.

3. **Revoke their sessions immediately** (so a still-valid JWT can't keep going until expiry):

   ```sql
   DELETE FROM auth.sessions WHERE user_id = '<user-id>';
   DELETE FROM auth.refresh_tokens WHERE user_id = '<user-id>';
   ```

   (Banning blocks `getUser`, but nuking sessions/refresh tokens is belt-and-suspenders.)

4. **Block the IP** at Vercel Firewall, or enable **Attack Challenge Mode** if it's a swarm.

5. **If you cannot pin the source and spend is runaway:** revoke the Anthropic API key (https://console.anthropic.com/settings/keys). Generation goes down globally — acceptable vs. a $1000 bill. Post sev-high comms.

6. **Re-enable** the key after the attacker is contained; verify legit generation.

**Containment recap:** Ban → kill sessions → IP block → (last resort) kill the key.

**Recovery:** Spend flattens. Restore any disabled key. Audit how many tokens/$ were burned via Anthropic usage.

**Post-mortem fix:** Daily per-user hard cap, spend-velocity circuit breaker, alert on Anthropic spend rate (not total). Consider local JWT verification so banning is enforced without a Supabase round-trip and you can maintain a fast in-memory denylist.

---

## 14. Admin secret compromised (/api/admin/ship-feature abused)

**Detection signals:** Resend dashboard shows emails you didn't send. `feature_requests` rows flipped to `status='done'` unexpectedly. Sentry/Vercel logs show POSTs to `/api/admin/ship-feature` you didn't make. The endpoint auths only on the `x-admin-secret` header equal to `ADMIN_SECRET`.

**Immediate response (first 5 min):**

1. **Rotate `ADMIN_SECRET` now.** Vercel → Project → Settings → Environment Variables → edit `ADMIN_SECRET` → set a new long random value → **Redeploy** (env change needs a redeploy to take effect).
   ```bash
   vercel env rm ADMIN_SECRET production
   vercel env add ADMIN_SECRET production      # paste a fresh 32+ char secret
   vercel --prod                               # redeploy so the new value is live
   ```
2. Stop further abuse — once the secret is rotated, the attacker's secret is dead.

**Containment:**

- Assess damage. Which features were wrongly marked done?
  ```sql
  SELECT id, title, status FROM feature_requests WHERE status = 'done' ORDER BY id;
  ```
  Revert wrongly-shipped ones:
  ```sql
  UPDATE feature_requests SET status = 'open' WHERE id = '<request-id>';
  ```
- Which emails went out wrongly? Check `feature_email_log` (this is the idempotency table — it records who was emailed):
  ```sql
  SELECT request_id, user_id FROM feature_email_log WHERE request_id = '<request-id>';
  ```
  You can't un-send email. If wrong users got "your feature shipped" emails, send a brief correction (Scenario 26 tone) only if it caused real confusion.

**Recovery:** New secret in place, bad statuses reverted. Confirm the endpoint rejects the old secret (expect 401).

**Post-mortem fix:** Add IP allowlist or move admin actions behind authenticated owner-only auth (not a shared static secret). Log every admin call to a table. Rate-limit the admin endpoint.

---

## 15. Environment variable / API key leaked (logs, commit, Sentry payload)

**Detection signals:** A secret appears in a Sentry event payload, a `console.log`, a public commit, or someone tells you. GitHub secret scanning alert.

**Rotation priority order (most dangerous first):**

1. `SUPABASE_SERVICE_KEY` — full DB + auth admin (see Scenario 16). **Rotate first.**
2. `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — money.
3. `ANTHROPIC_API_KEY` / `APP_ANTHROPIC_API_KEY` — direct spend.
4. `ADMIN_SECRET` — admin endpoint.
5. `RESEND_API_KEY` — can send email as you (phishing risk).
6. `ELEVENLABS_API_KEY`, E2B key, Higgsfield key, `GROQ_API_KEY`, `CEREBRAS_API_KEY` — metered spend.
7. `NEXT_PUBLIC_*` — these are **already public** by design (shipped to the browser). The anon key is fine to be public _because RLS protects data_; confirm RLS is on. Service key is NOT a `NEXT_PUBLIC_` var — verify it never got that prefix.

**Immediate response (per key):**

- Generate a new key at the provider, update Vercel env, redeploy.
  ```bash
  vercel env rm <KEY> production && vercel env add <KEY> production && vercel --prod
  ```
- Revoke the old key at the provider so the leaked value is dead.

**Containment:**

- If leaked in a git commit: rotating is the real fix (the value in history is forever). Optionally scrub history (`git filter-repo`) but rotation is what matters.
- If leaked in Sentry payloads: scrub the events and add a `beforeSend` filter to strip secrets going forward.

**Recovery:** All affected keys rotated, old ones revoked, prod redeployed and verified.

**Post-mortem fix:** Add a pre-commit secret scanner (gitleaks). Configure Sentry `beforeSend` to redact tokens/keys. Audit logs for any `console.log` of secrets.

---

## 16. Supabase service key exposed (most dangerous credential)

**Detection signals:** `SUPABASE_SERVICE_KEY` value seen anywhere it shouldn't be. This key **bypasses Row Level Security** — full read/write/delete on every table and full auth admin (ban users, delete users, mint tokens). Treat as total compromise.

**Immediate response (first 5 min) — DO ALL OF THIS:**

1. **Rotate the key.** Supabase → Project → Settings → API → **Service Role** → roll the key. (Rolling JWT-based keys may require rotating the JWT secret, which invalidates _all_ tokens — see step 4; weigh it.)
2. Update `SUPABASE_SERVICE_KEY` in Vercel env, redeploy:
   ```bash
   vercel env rm SUPABASE_SERVICE_KEY production
   vercel env add SUPABASE_SERVICE_KEY production
   vercel --prod
   ```
3. **Check for damage** in the Supabase logs explorer — look for admin API calls / bulk reads/writes you didn't make.

**Containment:**

- Assume data was readable. Check for exfiltration-shaped queries (large SELECTs) and tampering (unexpected UPDATEs/DELETEs) in logs.
- If the attacker may have created backdoor admin accounts:
  ```sql
  SELECT id, email, created_at FROM auth.users
  WHERE created_at > '<suspected-breach-time>' ORDER BY created_at;
  ```

4. **If you believe sessions were minted by the attacker, rotate the JWT secret** (Supabase → Settings → API → JWT Settings). This logs out _everyone_ (all tokens invalid) — disruptive but definitive during a real breach.

**Recovery:** New service key live, JWT secret rotated if needed, backdoor accounts banned/deleted, prod verified.

**Post-mortem fix:** Ensure the service key is server-only and never in `NEXT_PUBLIC_*`, never logged. Verify RLS is enabled on every table so an anon-key leak alone can't read data. Consider scoping admin operations to specific service patterns and monitoring admin API usage.

---

## 17. GitHub repository breach (unknown commits / PRs)

**Detection signals:** Commits or PRs from an actor you don't recognize, force-pushes, new collaborators, changed Actions secrets. Vercel auto-deploys on push to `main` — so **a malicious push to main auto-deploys to prod.**

**Immediate response (first 5 min):**

1. **Disconnect the auto-deploy blast radius:** Vercel → Project → Settings → Git → temporarily disable automatic production deployments (or pause the Git integration) so further malicious pushes don't ship.
2. **Lock the repo:** GitHub → Settings → Manage access — remove unknown collaborators. Settings → Branches — ensure `main` is protected (require PR review). Rotate your GitHub token/password, enable/verify 2FA.
3. Check the latest deployed commit vs. what you authored. If a bad commit deployed → **rollback** (Scenario 7).

**Containment:**

- Audit recent commits: `git log --oneline -20` and GitHub's "Security log" (Settings → Security log) for unauthorized actions.
- Rotate **all** secrets that live in GitHub Actions / repo secrets, and any app secret that could have been read from the repo. Treat as Scenario 15 full rotation.
- Force-push your last known-good `main` if history was tampered: `git push --force-with-lease origin <good-sha>:main` (only if you're certain of the good SHA).

**Recovery:** Repo locked, secrets rotated, good code deployed, auto-deploy re-enabled once safe.

**Post-mortem fix:** Branch protection on `main` (require review even for yourself isn't possible solo, but require status checks + no force-push). 2FA mandatory. Minimal collaborator access. Don't store long-lived secrets in repo.

---

## 18. JWT token theft / session hijacking

**Detection signals:** A user reports actions they didn't take, or you see one `user_id` from many IPs/geos simultaneously in PostHog/Supabase logs. Token reuse across impossible geographies.

**Immediate response:**

1. Kill that user's sessions:
   ```sql
   DELETE FROM auth.sessions WHERE user_id = '<user-id>';
   DELETE FROM auth.refresh_tokens WHERE user_id = '<user-id>';
   ```
   The stolen access token works until it expires (short TTL); refresh is dead so it can't renew. To hard-cut even unexpired access tokens, ban then unban won't help — JWTs are valid till expiry. For a definitive global cut you'd rotate the JWT secret (logs everyone out).
2. Force the user to re-authenticate; tell them to reset their password.

**Containment:** If you can't scope it to one user and it looks systemic (e.g., a leaked signing secret), rotate the Supabase JWT secret — invalidates all tokens, logs everyone out. Reserve for confirmed systemic theft.

**Recovery:** Affected sessions cleared, user re-authenticated.

**Post-mortem fix:** Short access-token TTL (Supabase default is fine), refresh-token rotation enabled in Supabase Auth settings. Don't expose tokens in URLs/logs. Sentry `beforeSend` redaction so tokens never land in error payloads.

---

## 19. DDoS / volumetric attack

**Detection signals:** Massive traffic burst, mostly from few IPs / odd user agents / odd paths, 4xx/5xx flood, Vercel bandwidth + function invocations spiking. Vercel usually absorbs L3/L4 automatically.

**Immediate response (first 5 min):**

1. Vercel → Firewall (https://vercel.com/<team>/<project>/firewall) → enable **Attack Challenge Mode** — challenges all visitors, lets real users through, stops bots. This is the big red button.
2. Add rate-limit / IP-block rules for the worst offenders.
   ```bash
   vercel firewall            # inspect; create rules in the dashboard for speed under pressure
   ```

**Containment:**

- Block offending IP ranges / ASNs and bad user agents via WAF rules.
- If a specific path is targeted (e.g., `/api/generate`), add a path-specific rate rule.
- Watch downstream spend (Anthropic/ElevenLabs/E2B) — a volumetric attack on paid endpoints is also a cost attack (Scenario 8).

**Recovery:** Turn off Attack Challenge Mode once the flood subsides (it adds friction for real users). Keep targeted IP blocks.

**Post-mortem fix:** Pre-stage Vercel WAF rules (managed rulesets, bot management). Ensure all expensive endpoints are auth-gated + rate-limited so a flood can't run up spend even if it gets through.

---

# DATA

## 20. User data accessed without authorization (cross-user read)

**Detection signals:** A user reports seeing another user's project/notes. Sentry/logs show queries returning other users' rows. Suspected missing RLS or an endpoint using `supabaseAdmin` (which bypasses RLS) without filtering by `user_id`.

**Immediate response:**

1. Reproduce: which endpoint leaks? Endpoints that use `supabaseAdmin` must manually filter `.eq('user_id', userId)` — RLS does NOT protect admin-client queries. Audit the offending route.
2. Check Supabase logs explorer for cross-user reads. Look for queries missing a `user_id` filter.

**Containment:**

- If a specific endpoint is leaking and it's clearly missing a filter, the fix is a code change (add the `user_id` filter) — small, surgical, deploy it (fix only the broken file). If you can't fix instantly, disable that endpoint (rotate a dependency key or feature-flag it off).
- Verify RLS is **enabled** on every user-data table (`projects`, `notes`, `user_settings`, etc.): Supabase → Auth → Policies / Database → Tables → RLS toggle.

**Recovery:** Patched endpoint deployed and verified that user A cannot read user B's rows.

**Post-mortem fix:** RLS on all tables as defense-in-depth. Audit every `supabaseAdmin` query for a `user_id` filter. Add a test that asserts cross-user isolation.

---

## 21. Accidental data deletion (projects wiped, user_settings corrupted)

**Detection signals:** Users report lost projects, settings reset, missing data. A bad migration, a fat-fingered SQL `DELETE`/`UPDATE` without `WHERE`, or a buggy deploy.

**Immediate response (first 5 min):**

1. **STOP writes if a runaway process is still deleting** — disable the offending endpoint/deploy (rollback, Scenario 7) before recovering, or you'll restore into an active deletion.
2. Assess scope:
   ```sql
   SELECT COUNT(*) FROM projects;                       -- how much is gone?
   SELECT MAX(created_at) FROM projects;                -- when did it stop?
   ```

**Containment / Recovery — Supabase PITR (Point-In-Time Recovery):**

- Supabase → Database → **Backups** (https://supabase.com/dashboard/project/_/database/backups).
- **Daily backups** are available on Pro; **PITR** (restore to a specific second) requires the PITR add-on — **confirm before launch which you have.** If PITR isn't enabled, you only have daily snapshots.
- Restore options:
  - **PITR:** restore to a timestamp just before the deletion. This restores the **whole database** to that point (you lose writes after that timestamp — weigh it on a busy launch day).
  - **No PITR:** restore the latest daily backup (lose up to ~24h).
- **Safer surgical restore (preferred if data loss window matters):** spin up a restore into a _separate_ Supabase project / branch, export only the lost rows, and re-insert into prod — avoids rolling back everyone's recent activity.

**Post-mortem fix:** **Enable PITR before launch if not already** — daily-only backups are a 24h data-loss risk during a high-traffic launch. Never run `DELETE`/`UPDATE` in the SQL editor without a `SELECT` preview and an explicit `WHERE`. Take a manual backup right before any migration.

---

## 22. Redis data corruption (rate-limit counters / TTS cache)

**Detection signals:** Rate limits behaving wrongly (everyone blocked, or counters nonsensical), TTS returning wrong/garbled cached audio, Redis returning unexpected types.

**Immediate response:**

- Identify scope. Keys are namespaced: `rl:generate:*` (rate limits) and `tts:*` (TTS cache). Both are **disposable** — no source-of-truth data lives in Redis.

**Containment — safe targeted flush (never blind `FLUSHALL` on a shared DB):**

```bash
# Clear only rate-limit counters (safe — they regenerate; cap is 10/min so worst case
# a few users get a brief reset). Use SCAN, not KEYS, to avoid blocking Redis.
redis-cli -u "$REDIS_URL" --scan --pattern 'rl:generate:*' | \
  xargs -r -L 100 redis-cli -u "$REDIS_URL" DEL

# Clear only the TTS cache (safe — just forces regeneration / re-spend on next request):
redis-cli -u "$REDIS_URL" --scan --pattern 'tts:*' | \
  xargs -r -L 100 redis-cli -u "$REDIS_URL" DEL
```

- Only `FLUSHALL` if the entire DB is corrupt AND nothing else important shares it. Since both key types are disposable here, a full flush is _recoverable_ (counters reset, cache rebuilds at the cost of some re-spend) but check Upstash for other namespaces first.

**Recovery:** Counters reset on next request; cache repopulates. Rate limiting fails open meanwhile (Scenario 5 risk profile — watch spend if you flushed during a spike).

**Post-mortem fix:** Set TTLs on all cache keys (rate-limit keys already expire at 60s). Validate types on read. Keep TTS cache values versioned so a format change doesn't serve stale/garbled audio.

---

# PAYMENTS

## 23. Stripe webhook failing (users paid but didn't get Pro)

**Detection signals:** User says "I paid but I'm still on free." Stripe → Webhooks (https://dashboard.stripe.com/webhooks) shows failed/erroring deliveries (non-2xx) to your `/api/stripe/webhook`. Sentry: `[Stripe webhook]` errors. `user_settings.subscription_tier` still `free` for a paying customer.

**Immediate response (first 5 min):**

1. **Manually grant Pro** to the affected paying user (revenue-saving, instant):
   ```sql
   -- Find the user
   SELECT id, email FROM auth.users WHERE email = '<customer-email>';
   -- Grant Pro
   UPDATE user_settings
   SET subscription_tier = 'pro', subscription_status = 'active'
   WHERE user_id = '<user-id>';
   -- If no row exists yet:
   INSERT INTO user_settings (user_id, subscription_tier, subscription_status)
   VALUES ('<user-id>', 'pro', 'active')
   ON CONFLICT (user_id) DO UPDATE
   SET subscription_tier = 'pro', subscription_status = 'active';
   ```
2. Confirm in Stripe (https://dashboard.stripe.com/payments) that they actually paid before granting.

**Containment:**

- Why did the webhook fail? Check the webhook's failed events in Stripe → Webhooks → your endpoint → recent deliveries. Common causes: `STRIPE_WEBHOOK_SECRET` mismatch (signature verification fails → 400), or the `getUidByCustomer` lookup failing (no `stripe_customer_id` match AND email lookup miss).
- **Replay failed events** once the cause is fixed: Stripe Dashboard → Webhooks → endpoint → select failed event → **Resend**. Or via CLI:
  ```bash
  stripe events resend <evt_id>
  ```
- If the secret is wrong, fix `STRIPE_WEBHOOK_SECRET` in Vercel env and redeploy, then replay.

**Recovery:** Affected users on Pro, webhook healthy, failed events replayed. Verify a fresh test purchase flows end-to-end (Stripe test mode if possible, but launch-day = live; do a real low-risk check).

**Post-mortem fix:** The webhook already has the email-fallback `getUserByEmail` fix. Add alerting on webhook failure (Stripe can email you on failures: Webhooks → endpoint → enable failure notifications). Make `setTier` idempotent (it is — upsert) and log every event to a table for reconciliation.

---

## 24. Fraudulent charge / chargeback (stolen card buys Pro)

**Detection signals:** Stripe Radar flags (https://dashboard.stripe.com/radar), a dispute/chargeback notification, a sudden cluster of purchases from one source, or a card network alert.

**Immediate response:**

1. Stripe → Radar → review flagged payments. For a confirmed fraudulent payment, **refund it** (Stripe → Payments → the charge → Refund) and **block the customer** (Radar → block email/card/IP).
2. Downgrade the fraudulent account in Supabase:
   ```sql
   UPDATE user_settings SET subscription_tier = 'free', subscription_status = 'canceled'
   WHERE user_id = '<user-id>';
   UPDATE auth.users SET banned_until = 'infinity' WHERE id = '<user-id>';   -- if abusive
   ```

**Containment:**

- If you see a fraud cluster, raise Radar rules (block high-risk countries/cards temporarily, require CVC/3DS). Stripe → Radar → Rules.
- Chargebacks: you can submit evidence in Stripe → Disputes, but for digital goods bought with a stolen card you usually lose — accept it, refund proactively to avoid dispute fees where it's clearly fraud.

**Recovery:** Fraud refunded/blocked, account downgraded. Radar rules tuned.

**Post-mortem fix:** Enable 3D Secure / require CVC in Stripe. Turn on Radar's recommended rules. Watch for velocity (many cards, one account / one card, many accounts).

---

## 25. Pro user billed after cancel (subscription logic bug)

**Detection signals:** User says "I cancelled but got charged" or "I cancelled but still being billed." Mismatch between Stripe subscription status and `user_settings.subscription_status`.

**Immediate response:**

1. Check ground truth in Stripe: https://dashboard.stripe.com/subscriptions → find the customer → is the subscription actually `canceled`, or just set to `cancel_at_period_end`?
   - If still `active`/`cancel_at_period_end`, the cancel didn't fully go through → cancel it now in Stripe (immediately, or at period end per the user's intent).
2. Cross-check Supabase:
   ```sql
   SELECT user_id, subscription_tier, subscription_status, subscription_period_end, stripe_customer_id
   FROM user_settings WHERE user_id = '<user-id>';
   ```

**Containment:**

- If they were wrongly charged after a genuine cancel → **refund** the charge in Stripe (Payments → Refund) and set them to free:
  ```sql
  UPDATE user_settings SET subscription_tier = 'free', subscription_status = 'canceled'
  WHERE user_id = '<user-id>';
  ```
- Webhook handles `customer.subscription.deleted` → sets free. If the row is out of sync, the webhook may have failed (Scenario 23) — replay the `customer.subscription.deleted`/`updated` event.

**Recovery:** Stripe and Supabase agree; user refunded if owed; status correct.

**Post-mortem fix:** Make sure the cancel flow in-app actually calls Stripe (via `/api/stripe/portal` — Stripe Customer Portal is the safest place to let users cancel). Add a daily reconciliation job comparing Stripe subscription status to `user_settings`.

---

# COMMUNICATIONS

> During launch, a calm, fast, honest update beats silence. Don't over-promise an ETA. Update when status changes.

## 26. What to post on X during an outage

**Sev-1 — full outage:**

> Heads up — getbased.dev is having issues right now and some of you can't get in. I'm on it. Will update here the moment it's back. Sorry for the timing. 🛠️ (use ◈ if on-brand, no emoji per house style)

**Sev-2 — partial / one feature broken (e.g., generation):**

> Some of you are hitting errors when generating right now — looking into it. The rest of the app works. Update incoming shortly.

**Sev-3 — degraded / slow:**

> Things are a little slow right now under heavy launch traffic — working through it, everything's up. Thanks for the patience (and the support 🙏 / → keep it brand-appropriate).

**Upstream provider down (not your fault, still your problem):**

> Our auth/AI provider is having a wider outage right now, so login/generation may fail. Not much I can do but wait for them — tracking it and will post the second it clears.

**Recovery / all-clear:**

> Back up and fully working — generation, login, all of it. Thanks for hanging in there during launch chaos. If anything's still off for you, reply here.

**Rules:** No fake ETAs. Don't blame users. One update per status change. Pin the active incident tweet; unpin on all-clear.

## 27. What to say in Product Hunt comments if something breaks on launch day

**If it's broken right now:**

> Appreciate you trying it! We're getting hammered (good problem) and I'm fixing a hiccup live right now — give it a few minutes and refresh. I'll reply here when it's smooth. Thanks for the patience 🙏

**If a specific person reports a bug:**

> Thank you for flagging — that's exactly the kind of report I need on launch day. Looking at it now. Mind telling me what you were trying to build when it broke? Fixing fast.

**If it's an upstream outage:**

> One of our providers is having a wider outage so a few things are flaky right now — not the launch-day vibe I wanted! Tracking it closely, will update here. The support means a lot.

**Recovery:**

> Fixed — should be smooth now. Thanks for bearing with me on launch day. Try it again and let me know what you build. 🚀

**Rules for PH:** Reply to _every_ comment (engagement = ranking). Be human and grateful, never defensive. Turn bug reports into a conversation. Never argue with a hunter or downvoter.

---

## APPENDIX — Most-used emergency commands (copy/paste)

```sql
-- BAN a user instantly (kills their next auth check)
UPDATE auth.users SET banned_until = 'infinity' WHERE id = '<user-id>';

-- UNBAN
UPDATE auth.users SET banned_until = NULL WHERE id = '<user-id>';

-- Kill a user's live sessions (stop a hijacked/abusive token from refreshing)
DELETE FROM auth.sessions WHERE user_id = '<user-id>';
DELETE FROM auth.refresh_tokens WHERE user_id = '<user-id>';

-- Top generators (saved builds) last hour
SELECT user_id, COUNT(*) AS builds FROM projects
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id ORDER BY builds DESC LIMIT 20;

-- Suspicious new accounts last hour
SELECT id, email, created_at FROM auth.users
WHERE created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC;

-- Grant Pro manually (paid but webhook missed it)
INSERT INTO user_settings (user_id, subscription_tier, subscription_status)
VALUES ('<user-id>', 'pro', 'active')
ON CONFLICT (user_id) DO UPDATE
SET subscription_tier = 'pro', subscription_status = 'active';

-- Downgrade to free
UPDATE user_settings SET subscription_tier = 'free', subscription_status = 'canceled'
WHERE user_id = '<user-id>';
```

```bash
# Rollback prod deploy (fastest fix for a bad deploy)
vercel rollback                  # or `vercel promote <good-deployment-url>`

# Tail prod logs
vercel logs --follow

# Rotate an env var + redeploy
vercel env rm <KEY> production && vercel env add <KEY> production && vercel --prod

# Redis: PING / safe targeted flush (SCAN, never KEYS/FLUSHALL on shared DB)
redis-cli -u "$REDIS_URL" PING
redis-cli -u "$REDIS_URL" --scan --pattern 'rl:generate:*' | xargs -r -L 100 redis-cli -u "$REDIS_URL" DEL
redis-cli -u "$REDIS_URL" --scan --pattern 'tts:*'         | xargs -r -L 100 redis-cli -u "$REDIS_URL" DEL

# Replay a failed Stripe webhook event
stripe events resend <evt_id>
```

**Kill switches (which key to revoke to stop which spend):**
| Stop this | Revoke / rotate |
| --------- | --------------- |
| All AI generation | `ANTHROPIC_API_KEY` (console.anthropic.com/settings/keys) |
| TTS (ElevenLabs) | `ELEVENLABS_API_KEY` (falls back to Modal F5-TTS) |
| Code execution | E2B API key |
| Media gen | Higgsfield key |
| Admin endpoint | `ADMIN_SECRET` |
| Everything DB/auth (breach) | `SUPABASE_SERVICE_KEY` + JWT secret |

Remember: revoking a key takes the feature down for _everyone_. It's the last resort when you can't pin the abuser — but a dead feature beats a $1,000 bill.
