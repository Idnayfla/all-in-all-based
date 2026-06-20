#!/usr/bin/env node
// Creates Linear tickets for new Based initiatives: Blender, Offline/Ollama, crawl4ai, browser-use, stirling-pdf, Higgsfield video
import { execSync } from 'child_process';

const TEAM_ID = '061887b6-6bdb-437d-aa76-3a338fe73208';
const IN_PROGRESS = '6f1f2c6e-a4e7-4d78-809d-4be9ceab5991';
const TODO = 'c1ea5b4b-14ac-4d84-a75e-9e11bd1aaead';

async function createTicket({ title, description, stateId, priority = 2 }) {
  const mutation = `
    mutation {
      issueCreate(input: {
        teamId: "${TEAM_ID}"
        title: ${JSON.stringify(title)}
        description: ${JSON.stringify(description)}
        stateId: "${stateId}"
        priority: ${priority}
      }) {
        issue { identifier title url }
      }
    }
  `;
  const token = process.env.LINEAR_API_KEY;
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query: mutation }),
  });
  const data = await res.json();
  const issue = data?.data?.issueCreate?.issue;
  if (issue) {
    console.log(`✓ ${issue.identifier}: ${issue.title}`);
    console.log(`  ${issue.url}`);
  } else {
    console.error('✗ Failed:', JSON.stringify(data?.errors ?? data));
  }
  return issue;
}

const tickets = [
  {
    title: 'feat(higgsfield): founder + student promo video',
    description: `Generate demo/promo videos for Based using Higgsfield AI.

**Goal:** Face-reference video of Hus speaking to two audiences — students (productivity, notes, assignments) and founders (companion, momentum, launch support).

**Approach:**
- Upload face photo as reference element in Higgsfield
- Use soul_cinema_studio or seedance model for identity-faithful video
- Generate 15-30s clip: product demo + narration
- Export for use on landing page, ProductHunt, LinkedIn

**Audience:** Students + Founders`,
    stateId: IN_PROGRESS,
    priority: 1,
  },
  {
    title: 'feat(blender): AI assistant addon — prompt→scene + settings recommender',
    description: `Build a Blender Python addon that connects to Based's AI backend.

**Phase 1 — Prompt to scene:**
- Blender panel with text input
- Sends prompt + current scene context (objects, materials, viewport) to \`/api/blender\` endpoint
- Based returns bpy Python code
- Addon executes the code inside Blender's Python environment

**Phase 2 — Settings recommender:**
- Analyzes current render settings (engine, samples, resolution, lighting)
- Returns AI suggestions for quality/performance tradeoffs
- One-click apply

**Files to create:**
- \`blender-addon/based_ai.py\` — the Blender addon
- \`app/api/blender/route.ts\` — Next.js API endpoint
- Panel UI in Blender sidebar (N-panel)`,
    stateId: TODO,
    priority: 2,
  },
  {
    title: 'feat(offline): local-first mode with Ollama routing',
    description: `Route Based companion to a local Ollama instance when no internet is available.

**Done (this session):**
- \`tryOllama()\` added to \`lib/companionRouter.ts\` as first routing tier
- Activates when \`OLLAMA_URL\` env var is set
- Supports model selection via \`OLLAMA_MODEL\` (default: \`llama3.2\`)
- Streams response correctly via Ollama \`/api/chat\`

**Still needed:**
- Offline detection on the client side (navigator.onLine / ping check)
- UI indicator when running in offline/local mode
- Local STT: Whisper.cpp bundled in Electron (replaces Modal Whisper)
- Local storage: SQLite via better-sqlite3 (replaces Supabase) for Electron offline builds
- Sync-on-reconnect: queue messages locally, upload to Supabase when back online

**Env vars:**
- \`OLLAMA_URL=http://localhost:11434\`
- \`OLLAMA_MODEL=llama3.2\` (or any installed model)`,
    stateId: TODO,
    priority: 2,
  },
  {
    title: 'feat(crawl4ai): deep web content extraction for research',
    description: `Integrate crawl4ai for AI-optimized web scraping alongside Exa/Tavily.

**Done (this session):**
- \`lib/crawl4ai.ts\` created with \`crawl4aiExtract(url)\` and \`isCrawl4aiAvailable()\`
- Async task-based API: POST /crawl → poll /task/{id}
- Returns clean markdown, max 4000 chars
- No-op if \`CRAWL4AI_URL\` is not set

**Still needed:**
- Wire into \`lib/brainTools.ts\` as a "read URL" tool (when Based needs full page content)
- Docker setup docs for local deployment
- Vercel env: \`CRAWL4AI_URL=http://your-server:11235\` (self-hosted only)

**Docker:**
\`\`\`bash
docker run -p 11235:11235 unclecode/crawl4ai:latest
\`\`\``,
    stateId: TODO,
    priority: 3,
  },
  {
    title: 'feat(browser-use): agentic browser automation for Based',
    description: `Integrate browser-use so Based can autonomously browse and interact with web pages.

**What it does:** AI-controlled browser — navigate, click, fill forms, extract content. Useful for Based to automate tasks on behalf of users.

**Approach:**
- Run browser-use as a Python microservice (FastAPI + Playwright)
- Expose a \`POST /run\` endpoint: \`{ task: string, url?: string }\`
- Based calls it from a new brain tool: \`browsePage(task, url)\`
- Security: allowlist of permitted domains, sandboxed browser

**Repository:** github.com/browser-use/browser-use
**Requires:** Python 3.11+, Playwright, OpenAI/Anthropic key for the internal LLM

**Deferred until:** self-hosted server available (Mac Mini, Phase 2)`,
    stateId: TODO,
    priority: 3,
  },
  {
    title: 'feat(stirling-pdf): PDF processing for Based uploads',
    description: `Add PDF reading/processing capability to Based via Stirling-PDF microservice.

**What it does:** Based users upload PDFs → extract text, summarize, answer questions about the content.

**Approach:**
- Run Stirling-PDF as a Docker container
- Use endpoint: \`POST /api/v1/convert/pdf/text\`
- Wire into file upload handler in group chat / companion
- Pass extracted text to Based's context window

**Docker:**
\`\`\`bash
docker run -p 8080:8080 frooodle/s-pdf:latest
\`\`\`

**Env:** \`STIRLING_PDF_URL=http://localhost:8080\`
**Repository:** github.com/Stirling-Tools/Stirling-PDF`,
    stateId: TODO,
    priority: 3,
  },
];

for (const ticket of tickets) {
  await createTicket(ticket);
  await new Promise(r => setTimeout(r, 300));
}

console.log('\nDone.');
