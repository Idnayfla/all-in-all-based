# Based — Agent Roster

Sixteen specialist agents cover every function of the product. To invoke one, prefix your message:

```
[Agent: Architect] Should we move Redis memory to Supabase?
[Agent: Product] What should Phase 10 be?
[Agent: Designer] Review the Notes panel layout
[Agent: Growth] Write the beta launch announcement
[Agent: QA] Test plan for stable release
[Agent: DevOps] Check our Vercel spend vs user count
[Agent: Security] Audit the auth flow
[Agent: Chief of Staff] Log the decision to delay Music AI
[Agent: Senior Engineer] Why is audio broken in generated apps?
[Agent: Mobile] Review our PWA install prompt flow
[Agent: Data Analyst] What does our Day-7 retention look like?
[Agent: Legal] Do we need a cookie consent banner?
[Agent: Community] Synthesise this week's Discord feedback
[Agent: Finance] Model the cost of 500 Pro users vs RunPod A100
[Agent: Technical Writer] Document the /api/v1/generate endpoint
[Agent: AI Engineer] Why is the planner producing generic file plans?
```

Without a prefix, Claude defaults to **Full-Stack Engineer** mode.

---

| Agent               | File                  | Core Output                               |
| ------------------- | --------------------- | ----------------------------------------- |
| Architect           | `architect.md`        | System design, scalability decisions      |
| Product Manager     | `product.md`          | Roadmap, specs, prioritization            |
| UI/UX Designer      | `designer.md`         | Design system, component layouts          |
| Full-Stack Engineer | (default)             | Code, bug fixes, features                 |
| Growth Engineer     | `growth.md`           | Copy, SEO, conversion                     |
| QA Engineer         | `qa.md`               | Test plans, bug triage                    |
| DevOps / SRE        | `devops.md`           | Infra, cost, monitoring                   |
| Security Engineer   | `security.md`         | Auth, data, API security                  |
| Chief of Staff      | `chief-of-staff.md`   | Decisions, changelog, tracking            |
| Senior Engineer     | `senior-engineer.md`  | Deep bug diagnosis, pipeline fixes        |
| Mobile Engineer     | `mobile.md`           | PWA, service workers, iOS/Android, stores |
| Data Analyst        | `data-analyst.md`     | Funnels, retention, A/B testing, metrics  |
| Legal & Compliance  | `legal.md`            | Privacy, ToS, GDPR/PDPA, compliance       |
| Community Manager   | `community.md`        | Feedback, Discord, support, changelog     |
| Finance & Revenue   | `finance.md`          | MRR, unit economics, pricing, API costs   |
| Technical Writer    | `technical-writer.md` | API docs, user guides, error messages     |
| AI Engineer         | `ai-engineer.md`      | Prompt arch, model selection, pipeline    |
