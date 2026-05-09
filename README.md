<div align="center">

# ⚡ All-In-All-Based (AIAB)

### An AI-powered creative and development platform — built solo from scratch.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-all--in--all--based.vercel.app-7c6af7?style=for-the-badge&logo=vercel)](https://all-in-all-based.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Anthropic](https://img.shields.io/badge/Claude%20API-Anthropic-cc785c?style=for-the-badge)](https://www.anthropic.com/)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel)](https://vercel.com/)

</div>

---

## What is AIAB?

**AIAB** is a self-built AI platform that combines code generation, image creation, video generation, and live execution — all in one browser-based interface.

Describe what you want. AIAB plans it, builds it, runs it, and lets you publish it — without leaving the tab.

~45 features. 1 developer.

---

## ✨ Features

### 🧠 Multi-Model Architecture
- **Haiku** — file planning, memory extraction, post-generation summaries
- **Sonnet** — general conversation
- **Opus** — full multi-file code generation
- **FLUX / Nano Banana 2** — text-to-image and image-to-image via fal.ai
- **Seedance 2.0** — text-to-video and image-to-video via ByteDance (with audio toggle)

### 💻 Code Generation
- 3-step pipeline: Haiku plans → Opus generates → Haiku summarises
- Multi-file output with live progress bar (per-file status + %)
- Supports HTML/CSS/JS, Python, Node.js
- Files auto-split at ~600 lines
- Post-generation HTML sanitization and safety injection

### 🎨 Image Generation & Editing
- Text-to-image and image-to-image (FLUX, Nano Banana 2)
- **Image Editor Modal:**
  - Transform mode — image-to-image with FLUX
  - Inpaint mode — draw mask on canvas (adjustable brush 8–60px, undo, clear) → Flux Pro Fill
  - Chain editing — use any result as new source image
  - Download from modal

### 🎬 Video Generation
- Text-to-video and image-to-video via Seedance 2.0
- Audio toggle (off by default)
- Autoplay, controls, loop, download

### 📁 Project & File Management
- Create (custom name modal), load, rename, delete projects
- Auto-save to localStorage on every change
- Projects and files sorted by recency
- Export full project as ZIP via JSZip

### 🧪 Execution & Preview
- Live HTML iframe preview with inline CSS/JS injection
- Python + Node.js execution via E2B sandbox (terminal output)
- Publish to Netlify — SHA-1 hashing, multi-file deploy, returns live URL

### 🧩 Memory System
- **Global memory** — auto-extracted by Haiku, stored in Redis, injected into every request
- **Per-project memory** — localStorage, editable in Settings
- Manual save via Settings panel

### 🕵️ Incognito Mode
- No memory saved, no messages persisted
- All messages wiped on toggle-off
- Session banner displayed

### 🎨 UI & Animations
- Framer Motion throughout — message slide-ins, chip staggers, modal zooms, spring interactions
- Shimmer loading cards during image/video generation
- Animated BASED logo with configurable shape and colour
- Debug panel — raw SSE event stream, colour-coded, timestamped, clearable
- 4-panel layout: Chat / Editor / Preview / Debug with animated tab switching
- Mobile-optimised sidebar with spring slide-out animation

### 🛡 Error Handling
- Friendly FAL error mapping (no_media_generated, balance exhausted, rate limits → plain English)

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| AI — Text | Anthropic Claude (Haiku, Sonnet, Opus) |
| AI — Image | fal.ai (FLUX, Nano Banana 2, Flux Pro Fill) |
| AI — Video | ByteDance Seedance 2.0 via fal.ai |
| Code Editor | Monaco Editor |
| Code Execution | E2B Sandbox |
| Memory Storage | Redis |
| File Export | JSZip |
| Deployment | Vercel + Netlify (publish target) |
| Animations | Framer Motion |
| Styling | Tailwind CSS v4 |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Anthropic API Key → [console.anthropic.com](https://console.anthropic.com)
- E2B API Key → [e2b.dev](https://e2b.dev)
- fal.ai API Key → [fal.ai](https://fal.ai)
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
FAL_KEY=your_fal_api_key
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