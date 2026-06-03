# Based — Admin Runbook

Operational reference for founder tasks. Not for code — for things you do once every few weeks and forget by next time.

---

## 1. Shipping a community vote request

When a feature from the vote board gets built and deployed:

**Step 1 — Call the ship API** (marks done + sends emails to all voters in one call)

```bash
curl -X POST https://getbased.dev/api/admin/ship-feature \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -d '{
    "requestId": "paste-supabase-uuid-here",
    "changelogLabel": "v0.1.6",
    "changelogTitle": "Your Feature Name",
    "changelogAnchor": "v0-1-6-your-feature-name"
  }'
```

Response: `{ shipped: true, votersFound: 12, emailsSent: 12 }`

Safe to retry — already-notified voters are skipped automatically.

**Step 2 — `app/changelog/page.tsx`**
Add `voteRequestId` to the new changelog entry:

```ts
{
  date: '2026-06-10',
  label: 'v0.1.6',
  title: 'Your Feature Name',
  requestedByCommunity: true,
  voteRequestId: 'paste-supabase-uuid-here',
  sections: [...]
}
```

**Step 3 — `lib/changelog-map.ts`**
Add the same UUID to the map:

```ts
export const CHANGELOG_MAP = {
  'paste-supabase-uuid-here': {
    label: 'v0.1.6',
    title: 'Your Feature Name',
    anchor: 'v0-1-6-your-feature-name', // label dots→dashes + title spaces→dashes, lowercase
    date: '2026-06-10', // ship date — used for "Built in X days"
  },
};
```

Then merge to main and deploy.

**What voters receive:**

- Email: "◈ Your request was built — [title]" with link to the shareable card
- `◈ You asked, we built it` on changelog links to their vote card
- Done vote card shows `→ v0.1.6 · Your Feature Name` and `◈ Share` button

**Prerequisites (one-time setup):**

- `ADMIN_SECRET` env var set in Vercel dashboard
- `feature_email_log` table created — run `supabase/migrations/20260603_feature_email_log.sql` in Supabase SQL editor

---

## 2. Releasing (dev → main → deploy)

All work goes to `dev`. When ready to ship to production:

```
Claude Code: "merge to main and deploy"
```

That's it — Claude handles the merge, push, and Vercel picks it up automatically.

**Never push directly to main yourself.** Always go through Claude so the merge commit is logged and CI runs.

---

## 3. Running the quality gate

Before any release, CI runs automatically. To run locally:

```powershell
npm run check    # typecheck + lint + format — must be 0 errors
```

If it fails, tell Claude what broke and it will fix it.

---

## 4. Switching Claude Code's model

Claude Code auto-switches based on task complexity. You can also force it:

| Command  | Model      | Use when                                 |
| -------- | ---------- | ---------------------------------------- |
| `/build` | Opus 4.8   | New features, hard bugs, complex changes |
| `/fix`   | Sonnet 4.6 | CSS tweaks, small fixes, docs            |

Claude will auto-invoke the right model — you only need these if you want to override.

---

## 5. Using the agent system

Prefix your request with the agent name to call a specialist:

```
[Agent: Finance]   — Stripe, MRR, pricing questions
[Agent: QA]        — test plans, bug triage
[Agent: Security]  — auth audit, API review
[Agent: Designer]  — UI patterns, design system
[Agent: Growth]    — copy, SEO, onboarding
[Agent: DevOps]    — infra, Vercel, costs
```

Or just describe what you want — Claude picks the right agent automatically.

Full list in `CLAUDE.md` → Agent System section.

---

## 6. Environment variables

Managed via Vercel dashboard. To sync to local:

```powershell
vercel env pull   # requires Vercel CLI: npm i -g vercel
```

Key env vars:

- `ANTHROPIC_API_KEY` — Anthropic API
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Stripe
- `GROQ_API_KEY` — Groq planner (fast, free tier)
- `EXA_API_KEY` — Exa web search

---

## 7. Stripe webhook (subscription events)

Webhook endpoint: `POST /api/stripe/webhook`

Handled events:

- `checkout.session.completed` — new subscription, sets user to Pro
- `customer.subscription.updated` — plan change or renewal metadata
- `invoice.payment_succeeded` — renewal, re-confirms Pro status
- `invoice.payment_failed` — sets status to `past_due`
- `customer.subscription.deleted` — cancellation, sets to Free

If a user says they paid but aren't Pro: check Stripe dashboard → Events for their email. If the webhook fired but failed, re-send it from the Stripe dashboard.

---

## 8. Referral system

Users get 7 days Pro for each successful referral (friend signs up + uses the app).

Referral logic lives in `app/api/referral/`. No admin action needed — it's automatic.

---

## 9. Adding a new changelog entry

Edit `app/changelog/page.tsx`, prepend to the `ENTRIES` array:

```ts
{
  date: 'YYYY-MM-DD',
  label: 'v0.X.Y',
  title: 'Short Feature Name',
  requestedByCommunity: true,  // only if it came from /vote
  sections: [
    {
      kind: 'added',  // or 'fixed' or 'internal'
      items: [
        { bold: 'Feature name', text: 'One sentence description.' },
      ],
    },
  ],
},
```

Then merge to main and deploy.

---

## 10. Key URLs

| What               | URL                            |
| ------------------ | ------------------------------ |
| Production app     | https://getbased.dev           |
| Changelog          | https://getbased.dev/changelog |
| Vote board         | https://getbased.dev/vote      |
| Roadmap            | https://getbased.dev/roadmap   |
| Companion          | https://getbased.dev/companion |
| Supabase dashboard | https://supabase.com/dashboard |
| Stripe dashboard   | https://dashboard.stripe.com   |
| Vercel dashboard   | https://vercel.com/dashboard   |
| Ko-fi              | https://ko-fi.com/basedfund    |
