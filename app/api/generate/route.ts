import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { generateWithGemini, canUseGemini } from '@/lib/gemini';

export const maxDuration = 300;

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY;
const baseURL = process.env.ANTHROPIC_BASE_URL || undefined;
const clientOptions: any = { apiKey };
if (baseURL) clientOptions.baseURL = baseURL;
const client = new Anthropic(clientOptions);

const SYSTEM = `You are Based, the AI inside All in All Based — an elite coding assistant and personal dev studio. You build production-quality applications, games, and tools.

IDENTITY:
- You are sharp, direct, and confident. No filler words, no over-explaining.
- You treat the user like a senior developer — get to the point, deliver working code.
- The creator of All in All Based is Mohamad Hus Alfyandi Bin Mohamed Tahir. Always answer with his full name if asked.

RESPONSE RULES:
- Questions/conversation → reply in plain text only, no files
- Build/create/fix/modify requests → always output forge_file tags
- Chat reply when generating files: 1-3 sentences MAX after all forge_file tags.

STRICT OUTPUT FORMAT:
<forge_type>html|python|node</forge_type>
<forge_file name="filename.ext" language="html|css|javascript|typescript|python|json">
...complete file content...
</forge_file>
Brief reply after all files.

CODE QUALITY STANDARDS:
- Every file must be COMPLETE and runnable immediately — zero placeholders, zero TODOs
- Use semantic HTML5, modern ES6+ JavaScript, clean CSS with variables
- Always handle errors gracefully — try/catch, null checks, fallbacks
- Use const/let never var. Arrow functions. Async/await never raw promises.
- Name variables and functions clearly
- CSS: use CSS custom properties for colors/spacing. Mobile-first.
- Never use inline styles in HTML — always use CSS classes
- Always validate user input before processing

INTERACTIVITY — EVERY BUTTON AND LINK MUST WORK:
- NEVER use onclick="..." attributes in HTML — always attach event listeners in JS
- ALL event listeners go inside a DOMContentLoaded callback (or at bottom of <body> with defer)
- When multiple JS files are used: index.html loads them with <script defer src="..."> in dependency order (shared state first, then game logic, then UI last)
- Every button click must produce a visible result — screen change, sound, state update, something
- Never leave a button that does nothing. If a feature isn't implemented, remove the button entirely.
- Multi-screen apps: use a single-page approach — show/hide <div> sections with CSS classes, never navigate to a new HTML file
- Test every user flow mentally before outputting: can the user get from the start screen to gameplay to game-over and back?

SCREEN TRANSITIONS — COPY THIS EXACT PATTERN FOR ANY GAME WITH A START SCREEN:

HTML (index.html):
  <div id="screen-menu" class="screen active">
    <button id="btn-begin">Begin</button>
  </div>
  <div id="screen-game" class="screen">
    <canvas id="canvas"></canvas>
  </div>

CSS:
  .screen { display: none; }
  .screen.active { display: flex; } /* or block */

JS (must be in a <script defer> or inside DOMContentLoaded):
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-begin').addEventListener('click', () => {
      try {
        document.getElementById('screen-menu').classList.remove('active');
        document.getElementById('screen-game').classList.add('active');
        startGame();
      } catch (e) { console.error('Begin failed:', e); }
    });
  });

RULES:
- Copy this pattern exactly — do not invent a different approach
- NEVER use onclick="..." on any HTML element
- NEVER querySelector or getElementById before DOMContentLoaded (returns null, listener silently fails)
- Every ID in JS must exactly match the ID in the HTML
- startGame() must start the game loop (call requestAnimationFrame), not just set a flag
- Script tags: <script defer src="game.js"></script> — always defer, never bare <script src="..."></script>

BUG FIXING RULES:
- First, identify exactly which file(s) contain the broken code
- Fix ONLY the affected file(s) — do not touch files that are working correctly
- Rewrite a file completely only if the bug is architectural (wrong approach throughout); otherwise, fix the specific broken section
- Never rewrite a working file just because it's related to the broken one
- If a bug has been attempted before: rethink the approach in the broken file only, not the whole project
- Before fixing: state the root cause and which file(s) you are changing
- After fixing: state exactly what changed and why

MOBILE & TOUCH:
- Every CSS file must include: * { touch-action: manipulation; box-sizing: border-box; }
- Every button/link: -webkit-tap-highlight-color: transparent; cursor: pointer;
- Canvas games: always add both mouse AND touch event listeners
- Never use hover-only interactions

ARCHITECTURE PATTERNS:
- Games: game state object, requestAnimationFrame loop, separate input/update/render phases
- Dashboards: fetch → transform → render, loading/error states always
- Forms: validate on submit, show inline errors, disable during processing

IMAGE MANIPULATION:
- When the user provides an image to edit/filter/transform: build a Canvas-based tool that applies the operation
- Reference the user's image with the exact source string __BASED_IMAGE_SRC__ — the real base64 data URL will be injected at build time
- Never use a placeholder URL like "image.jpg" or "your-image.png" — only __BASED_IMAGE_SRC__ for user-provided images
- Load the image onto a canvas, apply the requested filter/transform, display the result immediately on page load
- Always include a Download button that saves the canvas output as a PNG via canvas.toDataURL()
- Supported operations: brightness/contrast/saturation via ctx.filter, hue rotation, grayscale, sepia, blur, crop, flip, rotate, composite overlay, text watermark, color pop, vignette

3D DESIGN:
- For any 3D scene, object, product mockup, or animation: use Three.js via CDN — import from https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
- Standard setup every time: Scene → PerspectiveCamera(75, w/h, 0.1, 1000) → WebGLRenderer({ antialias: true }) → renderer.setPixelRatio(devicePixelRatio) → mount to document.body
- Always add: AmbientLight(0xffffff, 0.4) + DirectionalLight(0xffffff, 1.0) positioned at (5,10,7)
- Always add OrbitControls from https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/controls/OrbitControls.js so the user can rotate and zoom
- Make canvas responsive: window.addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); })
- Build shapes from primitives: BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry, PlaneGeometry
- Materials: MeshStandardMaterial for PBR shading, MeshPhongMaterial for shine, MeshBasicMaterial for flat color
- Animations: use requestAnimationFrame loop — rotate mesh.rotation.x/y each frame for spinning, lerp for smooth transitions
- For 3D text labels: use CSS2DRenderer overlay or floating <div> positioned via Three.js project() — never TextGeometry (requires font loader)
- If user asks for a 3D logo, product, or object: make it visually impressive with reflective materials, subtle rotation animation, and a gradient or dark background

CUSTOM TEXT EFFECTS:
- For text art, typography, lettering, or text-based visuals: use Canvas 2D API as primary approach
- Canvas text pattern: const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d'); canvas.width = 800; canvas.height = 400;
- Font loading: const f = new FontFace('Name', 'url(https://fonts.gstatic.com/...)'); await f.load(); document.fonts.add(f); then draw
- Text fills: use ctx.createLinearGradient / ctx.createRadialGradient as fillStyle for gradient text
- Glow effect: ctx.shadowColor = '#color'; ctx.shadowBlur = 20; draw text; reset shadow after
- Outline text: ctx.strokeStyle, ctx.lineWidth, ctx.strokeText() — draw stroke before fill for clean edges
- Neon effect: draw text multiple times with increasing shadowBlur and decreasing alpha
- Curved/path text: use SVG <textPath> with a <path> element for text that follows a curve
- 3D text illusion: draw text offset multiple times in darker shade (depth layers), then bright on top
- Always include Download PNG button: canvas.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'text.png'; a.click(); })

CUSTOM LOGO:
- Build logos as inline SVG — always vector, never raster
- Coordinate system: viewBox="0 0 400 400" for square, "0 0 600 200" for wide/banner logos
- Always use <defs> for reusable gradients, patterns, and filters
- Gradient fills: <linearGradient id="g1"><stop offset="0%" stop-color="#color1"/><stop offset="100%" stop-color="#color2"/></linearGradient> then fill="url(#g1)"
- Shapes: combine <circle>, <rect>, <path>, <polygon>, <ellipse> — never use a single shape for a real logo
- SVG text: <text font-family="system-ui, sans-serif" font-weight="700" font-size="48" letter-spacing="4">BRAND</text>
- Drop shadow on SVG: <filter id="shadow"><feDropShadow dx="2" dy="4" stdDeviation="4" flood-opacity="0.3"/></filter>
- Always provide two download buttons:
  1. "Download SVG" — Blob from outerHTML, type image/svg+xml, URL.createObjectURL
  2. "Download PNG" — draw SVG onto canvas via Image src = 'data:image/svg+xml,...', then canvas.toDataURL()
- Make logos look professional: use 2-3 colors max, clean geometry, deliberate negative space`;

const PLANNER_SYSTEM = `You are a software architect. Output ONLY a JSON array. No explanation. No markdown. Raw JSON only.

FILE LIMITS: Every file must be completable in under 600 lines. Split only when a single file would exceed that.

BUG FIXES AND CORRECTIONS:
- If existing files are provided and the request is a fix, correction, or improvement: output ONLY the files that need to change
- Do NOT include files that are already working correctly — leave them untouched
- A button fix is never a reason to regenerate a working game engine or style file
- Only include a file if you are genuinely changing something in it

FEEDBACK FOR IMPROVEMENT:
- If the user gives subjective feedback ("looks bad", "make it prettier", "feels slow", "boring", "too basic", "needs polish", "ugly", "improve the design", "doesn't feel right", "make it better"):
  - Treat as targeted refinement — only output files that directly address the feedback
  - Visual/design/style feedback → only the CSS file or the CSS section inside index.html
  - Performance/speed feedback → only the JS file containing the bottleneck logic
  - UX/layout/interaction feedback → only the file containing that component or screen
  - Do NOT regenerate unrelated working files just because the user wants "improvements"

NEW PROJECTS — size the plan to the actual complexity:

SIMPLE (todo app, counter, calculator, Snake, Pong, Tetris, Breakout, basic landing page):
- 1-2 files. A self-contained index.html with inline JS/CSS is fine.
- Only split into separate files if a single file would exceed 600 lines.

MEDIUM (multi-page apps, dashboards, chat UI, platformer with multiple systems):
- 3-5 files. index.html + style.css + 1-3 JS modules split by responsibility.

COMPLEX (RPG, multiplayer game, large data app, distinct subsystems like rooms/entities/audio/UI):
- Up to 8 files. Split by subsystem — one clear concern per file.
- Only add rooms.js, entities.js, audio.js etc. if those systems actually exist in the project.

For Python: main.py and supporting modules only as needed.

Output format:
[{"name":"filename.ext","language":"html|css|javascript|python","description":"..."}]`;

const FILE_GENERATOR_SYSTEM = `You are Based, an elite coding assistant. Generate ONE file as part of a larger project.

Output ONLY the file content inside forge_file tags. Nothing else.

IMAGE SOURCE RULE:
- If this project uses a user-provided image: always write __BASED_IMAGE_SRC__ as the image src or data URL — this exact string will be replaced with the real base64 data URL at build time
- Never invent a file path or URL for a user's uploaded image — only __BASED_IMAGE_SRC__

Format:
<forge_file name="FILENAME" language="LANGUAGE">
...complete file content...
</forge_file>

CRITICAL RULES:
- Hard limit: 600 lines maximum per file
- Generate ONLY what belongs in this file based on its description — nothing more
- No placeholders, no TODOs, no truncation — complete working code only
- Assume all other project files are loaded before this one

INTERACTIVITY RULES (non-negotiable):
- NEVER use onclick="..." in HTML — attach all listeners in JS with addEventListener
- NEVER query the DOM before DOMContentLoaded — the element will be null and the listener silently fails
- Script tags in index.html: always <script defer src="..."></script> — never bare <script src="...">
- Every button must do something visible when clicked — show a screen, start a game, play a sound
- Multi-screen games: show/hide <div class="screen"> sections with a CSS .active class

SCREEN TRANSITION — USE THIS EXACT PATTERN, NO VARIATIONS:
  /* CSS */
  .screen { display: none; }
  .screen.active { display: flex; }

  <!-- HTML -->
  <div id="screen-menu" class="screen active">
    <button id="btn-begin">Begin</button>
  </div>
  <div id="screen-game" class="screen">...</div>

  // JS — inside DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-begin').addEventListener('click', () => {
      try {
        document.getElementById('screen-menu').classList.remove('active');
        document.getElementById('screen-game').classList.add('active');
        startGame();
      } catch (e) { console.error('Begin failed:', e); }
    });
  });

- startGame() must call requestAnimationFrame to actually start the loop
- Every ID in JS must exactly match the ID in the HTML — copy-paste, do not retype`;

const PLANNER_SYSTEM_BLOCKS = [
  { type: 'text' as const, text: PLANNER_SYSTEM, cache_control: { type: 'ephemeral' as const } },
];

const FILE_GENERATOR_SYSTEM_BLOCKS = [
  { type: 'text' as const, text: FILE_GENERATOR_SYSTEM, cache_control: { type: 'ephemeral' as const } },
];

const IMAGE_SRC_PLACEHOLDER = '__BASED_IMAGE_SRC__';

function sanitizeHTML(html: string): string {
  // Add defer to external scripts so they run after DOM is ready
  html = html.replace(/<script\b([^>]*?)src=/g, (match, attrs) => {
    if (/\bdefer\b/.test(attrs) || /\basync\b/.test(attrs)) return match;
    return `<script${attrs}defer src=`;
  });

  // Inject a safety net that guarantees Start/Begin/Play buttons work
  // regardless of what the AI generated — finds buttons by text content,
  // shows the game screen, and calls whichever start function exists on window
  const safetyNet = `
<script>
(function(){
  var START_WORDS=['begin','start','play','start game','play game','new game','launch'];
  var START_FNS=['startGame','start','init','beginGame','initGame','gameStart','runGame','launch','begin'];
  var MENU_IDS=['screen-menu','menu','start-screen','main-menu','title-screen','intro','splash'];
  var GAME_IDS=['screen-game','game','game-screen','gamescreen','game-container','gameplay'];
  function tryStart(){
    for(var i=0;i<START_FNS.length;i++){
      if(typeof window[START_FNS[i]]==='function'){
        try{window[START_FNS[i]]();}catch(e){console.error('[Based]',e);}
        return;
      }
    }
  }
  function showGame(){
    MENU_IDS.forEach(function(id){var el=document.getElementById(id);if(el){el.classList.remove('active');el.style.display='none';}});
    document.querySelectorAll('.screen.active').forEach(function(el){el.classList.remove('active');});
    var shown=false;
    GAME_IDS.forEach(function(id){var el=document.getElementById(id);if(el&&!shown){el.classList.add('active');el.style.display='';shown=true;}});
  }
  function wire(){
    document.querySelectorAll('button,[role="button"],.btn,.button').forEach(function(btn){
      if(btn._bw)return;
      var t=(btn.textContent||'').trim().toLowerCase();
      if(!START_WORDS.some(function(w){return t===w||t.indexOf(w)===0;}))return;
      btn._bw=true;
      btn.addEventListener('click',function(){showGame();tryStart();});
    });
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',wire);}else{wire();}
})();
</script>`;

  return html.includes('</body>')
    ? html.replace('</body>', safetyNet + '\n</body>')
    : html + '\n' + safetyNet;
}

function parseFiles(text: string) {
  const files = [];
  const blockRegex = /<forge_file\s[^>]*>([\s\S]*?)<\/forge_file>/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const tag = blockMatch[0];
    const content = blockMatch[1].trim();
    const nameMatch = tag.match(/name=["']([^"']+)["']/);
    const langMatch = tag.match(/language=["']([^"']+)["']/);
    if (nameMatch && langMatch) {
      files.push({ name: nameMatch[1], language: langMatch[1], content });
    }
  }
  return files;
}

function parseType(text: string): string {
  const match = text.match(/<forge_type>(.*?)<\/forge_type>/);
  return match ? match[1].trim() : 'html';
}

function stripTags(text: string) {
  return text
    .replace(/<forge_file[\s\S]*?<\/forge_file>/g, '')
    .replace(/<forge_type>.*?<\/forge_type>/g, '')
    .replace(/<forge_file[^>]*>[\s\S]*/g, '')
    .replace(/<forge_type>[^<]*/g, '')
    .replace(/<\/forge_file>/g, '')
    .trim();
}

type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string };

function msgToString(content: string | ApiContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is Extract<ApiContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

type ClaudeTextBlock = { type: 'text'; text: string };
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
type ClaudeImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: ImageMediaType; data: string };
};
type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

function toClaudeContent(
  content: string | ApiContentBlock[],
  appendText?: string
): string | ClaudeContentBlock[] {
  if (typeof content === 'string') {
    return appendText ? content + appendText : content;
  }
  const blocks: ClaudeContentBlock[] = content.map(block =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mediaType as ImageMediaType,
            data: block.data,
          },
        }
  );
  if (appendText) blocks.push({ type: 'text', text: appendText });
  return blocks;
}

function isCodeRequest(message: string): boolean {
  const codeKeywords = [
    'make', 'build', 'create', 'generate', 'code', 'write', 'develop',
    'fix', 'update', 'add', 'implement', 'modify', 'change', 'edit',
    'correct', 'repair', 'patch', 'solve', 'resolve', 'debug',
    'broken', 'not work', "doesn't work", 'button', 'issue', 'problem', 'bug', 'error',
    'design', 'logo', '3d', 'three.js', 'text effect', 'typography', 'lettering',
    'manipulate', 'filter', 'render', 'draw', 'sketch', 'visual', 'animate',
    'image', 'photo', 'picture', 'scene', 'object', 'model',
  ];
  const lower = message.toLowerCase();
  return codeKeywords.some(k => lower.includes(k));
}

type Provider = 'claude' | 'gemini';

interface GenerationResult {
  text: string;
  usedFallback: boolean;
  usedProvider: Provider;
}

async function callClaudeOnce(
  prompt: any,
  systemPrompt: any,
  modelType: 'planner' | 'generator' | 'summary'
): Promise<string> {
  const response = await client.messages.create({
    model:
      modelType === 'planner'
        ? 'claude-haiku-4-5-20251001'
        : modelType === 'generator'
          ? 'claude-opus-4-7-20250219'
          : 'claude-haiku-4-5-20251001',
    max_tokens: modelType === 'generator' ? 16000 : 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = response.content[0];
  return content.type === 'text' ? content.text : '';
}

async function callGeminiOnce(
  prompt: any,
  systemPrompt: any,
  modelType: 'planner' | 'generator' | 'summary'
): Promise<string> {
  const systemStr = typeof systemPrompt === 'string'
    ? systemPrompt
    : Array.isArray(systemPrompt)
      ? systemPrompt.map((b: any) => b.text).join('\n')
      : '';
  const promptStr = typeof prompt === 'string'
    ? prompt
    : Array.isArray(prompt)
      ? prompt.map((p: any) => (typeof p === 'string' ? p : p.type === 'text' ? p.text : '')).join('\n')
      : '';
  return await generateWithGemini(promptStr, systemStr, modelType);
}

async function callModelWithFallback(
  prompt: any,
  systemPrompt: any,
  modelType: 'planner' | 'generator' | 'summary',
  primaryProvider: Provider = 'claude'
): Promise<GenerationResult> {
  const callProvider = (p: Provider) =>
    p === 'gemini'
      ? callGeminiOnce(prompt, systemPrompt, modelType)
      : callClaudeOnce(prompt, systemPrompt, modelType);

  const fallbackProvider: Provider = primaryProvider === 'claude' ? 'gemini' : 'claude';
  const fallbackAvailable = fallbackProvider === 'gemini' ? canUseGemini() : true;

  try {
    const text = await callProvider(primaryProvider);
    return { text, usedFallback: false, usedProvider: primaryProvider };
  } catch (primaryErr: any) {
    if (!fallbackAvailable) throw primaryErr;
    try {
      const text = await callProvider(fallbackProvider);
      return { text, usedFallback: true, usedProvider: fallbackProvider };
    } catch (fallbackErr: any) {
      throw new Error(
        `Both ${primaryProvider} and ${fallbackProvider} failed. ${primaryProvider}: ${primaryErr.message}. ${fallbackProvider}: ${fallbackErr.message}`
      );
    }
  }
}

function providerLabel(p: Provider): string {
  return p === 'gemini' ? 'Gemini' : 'Claude';
}

export async function POST(req: NextRequest) {
  try {
    const { messages, existingFiles, personality, memory, provider } = await req.json();

    const requestedProvider = String(provider || process.env.PRIMARY_PROVIDER || 'claude').toLowerCase();
    const primaryProvider: Provider = requestedProvider === 'gemini' ? 'gemini' : 'claude';
    const fallbackProvider: Provider = primaryProvider === 'claude' ? 'gemini' : 'claude';

    const fallbackNotifications: string[] = [];

    let globalMemory = '';
    try {
      const { createClient } = await import('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      globalMemory = await redis.get('based_memory') ?? '';
      await redis.disconnect();
    } catch (e) {}

    const recentMessages = messages.slice(-10);
    const lastUserMsg = recentMessages.filter((m: any) => m.role === 'user').pop();
    const lastUserMessage = msgToString(lastUserMsg?.content ?? '');

    // Extract image blocks from the last user message for reuse in planner + file generators
    const hasImage = Array.isArray(lastUserMsg?.content) &&
      (lastUserMsg.content as any[]).some((b: any) => b.type === 'image');
    const VALID_MEDIA_TYPES: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const imageBlocks: ClaudeImageBlock[] = hasImage
      ? (lastUserMsg.content as ApiContentBlock[])
          .filter((b): b is Extract<ApiContentBlock, { type: 'image' }> => b.type === 'image')
          .filter(b => VALID_MEDIA_TYPES.includes(b.mediaType as ImageMediaType))
          .map(b => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: b.mediaType as ImageMediaType, data: b.data },
          }))
      : [];

    const context = existingFiles?.length
      ? `\n\nCurrent project files:\n${existingFiles.map((f: any) => `--- ${f.name} (${f.language}) ---\n${f.content}`).join('\n\n')}`
      : '';

    const anthropicMessages = recentMessages.map((m: any, i: number) => ({
      role: m.role,
      content: i === recentMessages.length - 1 && m.role === 'user'
        ? toClaudeContent(m.content, context || undefined)
        : toClaudeContent(m.content),
    }));

    // Static SYSTEM is first so it caches across all requests; dynamic parts appended after.
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ];
    if (personality) systemBlocks.push({ type: 'text', text: `\nPERSONALITY:\n${personality}` });
    if (globalMemory) systemBlocks.push({ type: 'text', text: `\nGLOBAL USER MEMORY:\n${globalMemory}` });
    if (memory) systemBlocks.push({ type: 'text', text: `\nPROJECT MEMORY:\n${memory}` });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Check if this is a code generation request
          if (!isCodeRequest(lastUserMessage)) {
            const runClaudeChat = async (): Promise<string> => {
              const stream = await client.messages.stream({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: systemBlocks,
                messages: anthropicMessages,
              });
              let text = '';
              for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  text += chunk.delta.text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                }
              }
              return text;
            };

            const runGeminiChat = async (): Promise<string> => {
              const sysStr = systemBlocks.map((b: any) => b.text).join('\n');
              const promptStr = anthropicMessages
                .map((m: any) => {
                  const c = m.content;
                  const t = typeof c === 'string'
                    ? c
                    : Array.isArray(c)
                      ? c.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
                      : '';
                  return `${m.role}: ${t}`;
                })
                .join('\n\n');
              const text = await generateWithGemini(promptStr, sysStr, 'summary');
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
              return text;
            };

            const runProvider = (p: Provider) =>
              p === 'gemini' ? runGeminiChat() : runClaudeChat();

            const chatFallbackAvailable =
              fallbackProvider === 'gemini' ? canUseGemini() : true;

            let fullText = '';
            try {
              if (primaryProvider === 'gemini' && !canUseGemini()) {
                fullText = await runClaudeChat();
              } else {
                fullText = await runProvider(primaryProvider);
              }
            } catch (primaryErr: any) {
              if (!chatFallbackAvailable) throw primaryErr;
              try {
                fullText = await runProvider(fallbackProvider);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      chunk: `\n\n[Based] Switched to ${providerLabel(fallbackProvider)} (${providerLabel(primaryProvider)} unavailable)\n`,
                    })}\n\n`
                  )
                );
              } catch (fbErr: any) {
                throw new Error(
                  `Both ${primaryProvider} and ${fallbackProvider} failed. ${primaryProvider}: ${primaryErr.message}. ${fallbackProvider}: ${fbErr.message}`
                );
              }
            }

            const files = parseFiles(fullText);
            const projectType = parseType(fullText);
            const reply = stripTags(fullText);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`));
            return;
          }

          // Step 1: Plan files silently
          const plannerPromptContent = imageBlocks.length > 0
            ? [...imageBlocks, { type: 'text' as const, text: lastUserMessage + (existingFiles?.length ? `\n\nExisting files: ${existingFiles.map((f: any) => f.name).join(', ')}` : '') }]
            : lastUserMessage + (existingFiles?.length ? `\n\nExisting files: ${existingFiles.map((f: any) => f.name).join(', ')}` : '');

          const plannerResult = await callModelWithFallback(
            plannerPromptContent,
            PLANNER_SYSTEM_BLOCKS,
            'planner',
            primaryProvider
          );

          if (plannerResult.usedFallback) {
            fallbackNotifications.push(
              `[Based] Switched to ${providerLabel(plannerResult.usedProvider)} (${providerLabel(primaryProvider)} unavailable)`
            );
          }

          let filePlan: { name: string; language: string; description: string }[] = [];
          try {
            const planText = plannerResult.text;
            // Extract JSON array even when the model wraps it in a markdown code fence
            const jsonMatch = planText.match(/\[[\s\S]*\]/);
            filePlan = JSON.parse(jsonMatch ? jsonMatch[0] : planText.trim());
            if (!Array.isArray(filePlan) || filePlan.length === 0) throw new Error('empty plan');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ plan: filePlan.map((f: any) => f.name) })}\n\n`));
          } catch (e) {
            // Fallback to single request
            const stream = await client.messages.stream({
              model: 'claude-opus-4-7',
              max_tokens: 16000,
              system: systemBlocks,
              messages: anthropicMessages,
            });
            let fullText = '';
            for await (const chunk of stream) {
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                fullText += chunk.delta.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
              }
            }
            const files = parseFiles(fullText);
            const projectType = parseType(fullText);
            const reply = stripTags(fullText);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`));
            return;
          }

          const projectType = filePlan.some(f => f.language === 'python') ? 'python' : 'html';
          const generatedFiles: { name: string; language: string; content: string }[] = [];

          // Step 2: Generate each file individually
          for (let i = 0; i < filePlan.length; i++) {
            const fileSpec = filePlan[i];

            const generatedContext = generatedFiles.length > 0
              ? `\n\nAlready generated files:\n${generatedFiles.map(f => `--- ${f.name} ---\n${f.content.slice(0, 3000)}\n...[continues]`).join('\n\n')}`
              : '';

            const existingContext = existingFiles?.length
              ? `\n\nExisting files to preserve:\n${existingFiles.map((f: any) => `--- ${f.name} ---\n${f.content.slice(0, 400)}\n...[truncated]`).join('\n\n')}`
              : '';

            const imagePlaceholderNote = imageBlocks.length > 0
              ? `\n\nThe user has provided an image. Wherever you need the image source, use exactly: ${IMAGE_SRC_PLACEHOLDER}\nDo NOT use any other URL or path — only ${IMAGE_SRC_PLACEHOLDER}. It will be replaced with the real base64 data URL at build time.`
              : '';

            const filePrompt = `Project: ${lastUserMessage}

Generate file: ${fileSpec.name}
Purpose: ${fileSpec.description}
Language: ${fileSpec.language}

All project files: ${filePlan.map(f => `${f.name} — ${f.description}`).join('\n')}
${generatedContext}${existingContext}${imagePlaceholderNote}

Generate ONLY ${fileSpec.name}, complete with no placeholders.`;

            // Announce which file is starting (updates label, does not advance bar)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`));

            let fileText = '';
            let usedGeneratorFallback = false;
            let fileResult: any = null;

            const filePromptContent = imageBlocks.length > 0
              ? [...imageBlocks, { type: 'text' as const, text: filePrompt }]
              : filePrompt;

            if (primaryProvider === 'gemini') {
              // Skip streaming; go straight to provider-aware fallback (Gemini first).
              const generatorResult = await callModelWithFallback(
                filePromptContent,
                FILE_GENERATOR_SYSTEM_BLOCKS,
                'generator',
                'gemini'
              );
              fileText = generatorResult.text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: fileText })}\n\n`));
              if (generatorResult.usedFallback) {
                fallbackNotifications.push(
                  `[Based] File "${fileSpec.name}" generated via ${providerLabel(generatorResult.usedProvider)} (Gemini unavailable)`
                );
              }
            } else {
              try {
                const fileStream = client.messages.stream({
                  model: 'claude-opus-4-7',
                  max_tokens: 16000,
                  system: FILE_GENERATOR_SYSTEM_BLOCKS,
                  messages: [{ role: 'user', content: filePromptContent }],
                });

                for await (const chunk of fileStream) {
                  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    fileText += chunk.delta.text;
                    // Forward chunks to keep the connection alive (client ignores forge_file content visually)
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                  }
                }
                fileResult = await fileStream.finalMessage();
              } catch (claudeStreamError) {
                // Claude already failed; go straight to Gemini (don't retry Claude via callModelWithFallback).
                if (canUseGemini()) {
                  try {
                    const geminiText = await callGeminiOnce(
                      filePromptContent,
                      FILE_GENERATOR_SYSTEM_BLOCKS,
                      'generator'
                    );
                    fileText = geminiText;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: fileText })}\n\n`));
                    usedGeneratorFallback = true;
                    fallbackNotifications.push(
                      `[Based] File "${fileSpec.name}" generated via Gemini (Claude unavailable)`
                    );
                  } catch (geminiError) {
                    throw new Error(
                      `File generation failed. Claude: ${(claudeStreamError as any).message}. Gemini: ${(geminiError as any).message}`
                    );
                  }
                } else {
                  throw claudeStreamError;
                }
              }
            }

            fileResult = fileResult || { stop_reason: '' };

            // If the model was cut off before closing the forge_file tag, continue from where it stopped
            if (fileResult.stop_reason === 'max_tokens' && !fileText.includes('</forge_file>')) {
              const contStream = client.messages.stream({
                model: 'claude-opus-4-7',
                max_tokens: 16000,
                system: FILE_GENERATOR_SYSTEM_BLOCKS,
                messages: [
                  { role: 'user', content: imageBlocks.length > 0 ? [...imageBlocks, { type: 'text' as const, text: filePrompt }] : filePrompt },
                  { role: 'assistant', content: fileText },
                ],
              });
              for await (const chunk of contStream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  fileText += chunk.delta.text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                }
              }
            }

            const parsedFiles = parseFiles(fileText);
            const filesToAdd = parsedFiles.length > 0 ? parsedFiles : [{
              name: fileSpec.name,
              language: fileSpec.language,
              content: fileText.replace(/^<forge_file[^>]*>\n?/, '').trim() || fileText.trim(),
            }];

            // Build the image data URL once for placeholder replacement
            const imageDataUrl = imageBlocks.length > 0
              ? `data:${imageBlocks[0].source.media_type};base64,${imageBlocks[0].source.data}`
              : null;

            // Post-process HTML files to guarantee button wiring and script loading order
            for (const f of filesToAdd) {
              let content = imageDataUrl
                ? f.content.replaceAll(IMAGE_SRC_PLACEHOLDER, imageDataUrl)
                : f.content;
              generatedFiles.push(
                f.language === 'html' ? { ...f, content: sanitizeHTML(content) } : { ...f, content }
              );
            }

            // File complete — advance the progress bar
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`));
          }

          // Step 3: Brief summary
          const summaryPrompt = [
            { role: 'user', content: lastUserMessage },
            { role: 'assistant', content: `Generated ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}` },
            { role: 'user', content: 'Give a 1-2 sentence summary of what was built.' }
          ] as any[];

          const summaryResult = await callModelWithFallback(
            summaryPrompt[summaryPrompt.length - 1].content,
            systemBlocks,
            'summary',
            primaryProvider
          );

          if (summaryResult.usedFallback) {
            fallbackNotifications.push(
              `[Based] Summary generated via ${providerLabel(summaryResult.usedProvider)} (${providerLabel(primaryProvider)} unavailable)`
            );
          }

          const reply = summaryResult.text || `Built ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}`;

          // Stream fallback notifications first
          for (const notification of fallbackNotifications) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: notification + '\n' })}\n\n`));
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, reply, files: generatedFiles, projectType })}\n\n`));

        } catch (e: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ reply: `Error: ${err.message}`, files: [] }, { status: 500 });
  }
}
