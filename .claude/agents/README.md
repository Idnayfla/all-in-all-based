# Based — Agent Roster

Eight senior agents cover every function of the product. To invoke one, prefix your message:

```
[Agent: Architect] Should we move Redis memory to Supabase?
[Agent: Product] What should Phase 10 be?
[Agent: Designer] Review the Notes panel layout
[Agent: Growth] Write the beta launch announcement
[Agent: QA] Test plan for stable release
[Agent: DevOps] Check our Vercel spend vs user count
[Agent: Security] Audit the auth flow
[Agent: Chief of Staff] Log the decision to delay Music AI
```

Without a prefix, Claude defaults to **Full-Stack Engineer** mode.

---

| Agent               | File                | Core Output                          |
| ------------------- | ------------------- | ------------------------------------ |
| Architect           | `architect.md`      | System design, scalability decisions |
| Product Manager     | `product.md`        | Roadmap, specs, prioritization       |
| UI/UX Designer      | `designer.md`       | Design system, component layouts     |
| Full-Stack Engineer | (default)           | Code, bug fixes, features            |
| Growth Engineer     | `growth.md`         | Copy, SEO, conversion                |
| QA Engineer         | `qa.md`             | Test plans, bug triage               |
| DevOps / SRE        | `devops.md`         | Infra, cost, monitoring              |
| Security Engineer   | `security.md`       | Auth, data, API security             |
| Chief of Staff      | `chief-of-staff.md` | Decisions, changelog, tracking       |
