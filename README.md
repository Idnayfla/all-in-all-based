<div align="center">

# ⚡ All-In-All-Based (AIAB)

### A browser-based AI coding studio — built solo from scratch.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-all--in--all--based.vercel.app-7c6af7?style=for-the-badge&logo=vercel)](https://all-in-all-based.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Anthropic](https://img.shields.io/badge/Claude%20API-Anthropic-cc785c?style=for-the-badge)](https://www.anthropic.com/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel)](https://vercel.com/)

</div>

---

## What is AIAB?

**AIAB** is a self-built AI-powered coding studio that runs entirely in the browser. Think Replit or Bolt.new — but designed, architected, and built solo.

Describe what you want to build. AIAB plans it, generates multi-file code, executes it in a live sandbox, and lets you iterate — all within a single interface.

---

## ✨ Features

### 🤖 Chat & AI
- Real-time streaming responses via Claude (Anthropic)
- Image attachments in chat (JPEG, PNG, WebP, GIF)
- Customizable AI personality via editable system prompt
- Context-aware suggestions on new projects

### 🧠 Multi-Model Architecture
- **Haiku** — planning, memory extraction, file structuring
- **Sonnet** — conversational chat
- **Opus** — full code generation per file

### 💻 Code Generation
- Multi-file generation with per-file progress tracking
- Supports HTML/CSS/JS, Python, and Node.js projects
- Files auto-split at ~600 lines
- Post-generation HTML sanitization and safety injection

### 📁 Project & File Management
- Create, rename, delete, and switch between named projects
- Auto-save to localStorage on every change
- Monaco Editor with full syntax highlighting (TS, JS, HTML, CSS, Python, JSON)
- Download individual files or full project as ZIP

### 🧪 Execution & Preview
- Live sandboxed iframe preview for HTML projects
- Python + Node.js execution via E2B sandbox (stdout/stderr output)
- Publish HTML projects to Netlify — returns a live public URL

### 🧩 Memory System
- **Global memory** — auto-extracted by Haiku after each conversation, stored in Redis
- **Per-project memory** — stored in localStorage, editable in Settings
- Memory injected into every AI request as context

### 🕵️ Incognito Mode
- No messages saved, memory not updated
- All messages wiped on toggle-off
- Session banner displayed during incognito

### 🐛 Debug Panel
- Stream event log (chunk / done / error / info), last 200 events
- Raw stream content viewer
- Event counters, auto-scroll, clear button

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| AI Models | Anthropic Claude (Haiku, Sonnet, Opus) |
| Code Editor | Monaco Editor |
| Code Execution | E2B Sandbox |
| Memory Storage | Redis |
| Deployment | Vercel + Netlify (publish target) |
| Animations | Framer Motion |
| Styling | Tailwind CSS v4 |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Anthropic API Key → [console.anthropic.com](https://console.anthropic.com)
- E2B API Key → [e2b.dev](https://e2b.dev)
- Redis instance (local or Upstash)
- Netlify API Token (optional, for publish feature)

### Installation

```bash
git clone https://github.com/Idnayfla/all-in-all-based.git
cd all-in-all-based
npm install
```

### Environment Variables

Create a `.env.local` file in the root:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
E2B_API_KEY=your_e2b_api_key
REDIS_URL=your_redis_url
NETLIFY_API_TOKEN=your_netlify_token
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 👤 Author

**Mohamad Hus Alfyandi**
- GitHub: [@Idnayfla](https://github.com/Idnayfla)
- LinkedIn: [linkedin.com/in/hus-alfyandi](https://linkedin.com/in/hus-alfyandi)

---

<div align="center">
  Built with curiosity and too many late nights. ⚡
</div>