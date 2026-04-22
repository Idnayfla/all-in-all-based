# All in All Based (AIAB)

**An AI-powered coding and productivity studio — one app for everything.**

🌐 **Live Demo:** [all-in-all-based.vercel.app](https://all-in-all-based.vercel.app)

---

## What is AIAB?

AIAB is a full-stack AI studio built to handle any task — from building websites and debugging code to answering questions and conducting deep research. Instead of juggling multiple tools, everything lives in one place.

---

## Features

- 🌐 **Website Builder** — Generate and preview full web applications through conversation
- 💬 **AI Chat** — Answer questions, plan projects, and assist with research in real time
- 🧠 **Dual Memory System** — Global Memory persists user preferences across all sessions; Project Memory is scoped per project
- 🐛 **Debug Log** — Tracks errors and auto-retries with alternative approaches when fixes fail
- 🖥️ **Code Editor** — Built-in editor to view, edit, and manage generated code
- 👁️ **Live Preview** — Instantly preview generated applications without leaving the app
- 💾 **Saved Projects** — Organize and revisit all your work in one place
- 📥 **Downloadable Files** — Export generated code and files directly
- 🔗 **Shareable Links** — Share projects with a single link
- 🎭 **Personality Mode** — Customise the AI's tone and behaviour
- 🕵️ **Incognito Mode** — Use the app without saving history or memory

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14, React |
| Language | TypeScript |
| AI | Anthropic Claude API (streaming) |
| Memory | Redis (global session state) |
| Database | PostgreSQL |
| Deployment | Vercel |
| PWA | Progressive Web App — installable on mobile |

---

## Architecture Highlights

- **Streaming Architecture** — Custom buffer management handles Anthropic's API event structure for real-time response delivery
- **Auto-Retry Logic** — Detects ineffective AI fixes and automatically triggers full rewrites with alternative approaches
- **Redis Global Memory** — Persists user context across sessions so the AI learns and adapts over time
- **PWA Support** — Fully installable on mobile with custom app icons and offline-ready structure

---

## Getting Started

```bash
git clone https://github.com/Idnayfla/all-in-all-based.git
cd all-in-all-based
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to run locally.

> **Note:** You will need your own Anthropic API key, Redis instance, and PostgreSQL database. Environment variable setup instructions coming soon.

---

## About the Developer

Built solo by **Mohamad Hus Alfyandi** — a full-stack developer transitioning into software engineering post-NS.

- 🔗 [LinkedIn](https://linkedin.com/in/hus-alfyandi-51a320271)
- 🌐 [Live App](https://all-in-all-based.vercel.app)
