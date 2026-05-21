# Based — Named Workflows

Invoke any workflow with: `[Workflow: <name>]`

The Orchestrator runs the agents in sequence, each output feeding into the next.

---

## Workflow: New Feature

**Trigger**: User requests a new panel, tool, or product capability.

```
Step 1 — Product
  → Define user story, acceptance criteria, scope boundary, success metric
  → Output: Feature spec (what it does, for whom, definition of done)

Step 2 — Architect
  → Design API shape, data model, performance implications, cost impact
  → Output: Technical design (how it's built, what it touches, risks)

Step 3 — Designer
  → Define component layout, states, interactions, brand compliance check
  → Output: UI spec (layout, states, copy guidelines)

Step 4 — Security
  → Identify attack vectors, data exposure risks, input validation needs
  → Output: Security requirements (must-haves before shipping)

Step 5 — Full-Stack
  → Implement per spec, per design, per security requirements
  → Output: Working code, TypeScript clean, no regressions

Step 6 — QA
  → Test plan: happy path, edge cases, regression, mobile
  → Output: Pass/fail report, any P0/P1 issues found

Step 7 — DevOps
  → Assess deploy impact: function cost, cold start, env vars needed
  → Output: Deploy checklist

Step 8 — Chief of Staff
  → Log the decision, update CHANGELOG.md, mark roadmap phase done
  → Output: Updated DECISIONS.md + CHANGELOG.md entries
```

---

## Workflow: Bug Fix

**Trigger**: Something is broken in production or beta.

```
Step 1 — QA
  → Reproduce the bug, classify severity (P0–P3), document exact steps
  → Output: Bug report with reproduction steps + severity

Step 2 — Security (conditional — only if P0/P1 or involves auth/data)
  → Is this exploitable? Data leak risk? Auth bypass?
  → Output: Risk assessment

Step 3 — Full-Stack
  → Root cause analysis, minimal targeted fix (never rewrite working files)
  → Output: Fix + explanation of root cause + what changed

Step 4 — QA verify
  → Confirm fix resolves the issue, no regressions introduced
  → Output: Verified / not verified

Step 5 — Chief of Staff (P0/P1 only)
  → Log as incident in DECISIONS.md
  → Output: Incident log entry
```

---

## Workflow: Beta → Stable (Promotion)

**Trigger**: Considering promoting `dev` → `main` (beta → getbased.dev).

```
Step 1 — QA
  → Run full stable release gate checklist (from qa.md)
  → Output: Gate status — all passed / blockers found

Step 2 — Product (only if QA passes)
  → Confirm all P0/P1 roadmap items for this phase are complete
  → Output: Product readiness sign-off

Step 3 — Security
  → Final check: auth flows, API keys, RLS policies, no secrets in repo
  → Output: Security sign-off or blockers

Step 4 — DevOps
  → Confirm env vars match between beta and production
  → Plan the promotion: `git merge dev → main`, Vercel auto-deploy
  → Output: Deploy plan

Step 5 — Growth
  → Draft launch announcement copy (if this is a named release)
  → Output: Announcement copy ready to post

Step 6 — Chief of Staff
  → Log the promotion decision, update CHANGELOG.md with release date
  → Output: Release log entry
```

---

## Workflow: Architecture Decision

**Trigger**: A significant technical choice that's hard to reverse (database, infra, API design, new service).

```
Step 1 — Architect
  → Present options with tradeoffs, recommend one, state what's irreversible
  → Output: ADR draft (decision + rationale + rejected alternatives)

Step 2 — Security (parallel)
  → Review the proposed architecture for security implications
  → Output: Security concerns or clearance

Step 3 — DevOps (parallel)
  → Cost model the proposed architecture at current + 10x user scale
  → Output: Cost estimate + operational complexity rating

Step 4 — Chief of Staff
  → Finalize ADR with Security + DevOps input, log to DECISIONS.md
  → Output: Final DECISIONS.md entry
```

---

## Workflow: Weekly Review

**Trigger**: Start of week or sprint review. Takes ~5 minutes.

```
Step 1 — Chief of Staff
  → What decisions were made this week?
  → What shipped? What was logged in CHANGELOG.md?
  → What's in progress vs blocked?
  → Output: Week summary

Step 2 — Product
  → Are we on track for the current phase?
  → What's the one thing that must ship this week?
  → Output: Priority call

Step 3 — DevOps
  → Any cost anomalies? Error rate trends? Anything to monitor?
  → Output: Infrastructure health snapshot
```

---

## Workflow: Security Audit

**Trigger**: Before any stable release, or when a new auth/data feature ships.

```
Step 1 — Security
  → Review against Based threat model (from security.md)
  → Check: RLS policies, API key exposure, input sanitisation, rate limiting
  → Output: Audit findings with severity

Step 2 — Architect
  → For each finding: is this fixable at the design level?
  → Output: Architectural fixes vs code-level fixes

Step 3 — DevOps
  → Are secrets correctly managed? Any leaked env vars in logs?
  → Output: Secrets + infra check

Step 4 — Chief of Staff
  → Log audit results and any required follow-up
  → Output: Audit log entry in DECISIONS.md
```
