import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../_auth';
import { searchWeb } from '@/lib/tavily';
import { getWeather } from '@/lib/weather';

export const maxDuration = 300;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.APP_ANTHROPIC_API_KEY,
});

const PANTHEON_KEY = process.env.PANTHEON_OWNER_KEY ?? 'pk_owner_based_internal';
const PANTHEON_URL = process.env.PANTHEON_API_URL ?? 'https://pantheon-api.vercel.app';

async function callPantheon(
  messages: Array<{ role: string; content: string }>,
  taskType: 'fast_chat' | 'chat',
  maxTokens = 8000
): Promise<string> {
  const res = await fetch(`${PANTHEON_URL}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PANTHEON_KEY}` },
    body: JSON.stringify({ messages, task_type: taskType, stream: false, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? `Pantheon ${res.status}`);
  }
  const data = await res.json();
  return data.text ?? '';
}

async function* streamPantheon(
  messages: Array<{ role: string; content: string }>,
  taskType: 'fast_chat' | 'chat',
  maxTokens = 16000
): AsyncGenerator<string> {
  const res = await fetch(`${PANTHEON_URL}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PANTHEON_KEY}` },
    body: JSON.stringify({ messages, task_type: taskType, stream: true, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? `Pantheon ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === 'text') yield parsed.text;
      } catch {}
    }
  }
}

const SYSTEM = `You are Based — a sharp, direct AI that can do anything: answer questions, do math, analyse data, write, explain, plan, AND build fully working web apps, games, dashboards, and tools.

IDENTITY:
- Sharp, direct, confident. No filler words, no over-explaining.
- You are an AI for EVERYTHING — not just code. Treat every request on its own terms.
- When someone gives you data and asks for analysis, totals, or a summary — just answer it. Do NOT build an app for it.
- When someone asks you to BUILD something — build it completely with forge_file tags.
- The creator of All in All Based is Mohamad Hus Alfyandi Bin Mohamed Tahir. Always answer with his full name if asked.

RESPONSE RULES:
- Questions, calculations, analysis, writing, explanations → reply in plain text only, no files
- Build/create/fix/modify/make/generate requests → always output forge_file tags
- Chat reply when generating files: 1-3 sentences MAX after all forge_file tags.
- NEVER say "check the editor", "see the preview", "look at the editor", or any variation when you are NOT generating files — your text reply IS the complete answer.
- NEVER convert a data question into an app. If someone pastes an itinerary and asks for totals, calculate it and reply directly. Same for any maths, budgets, lists, or data analysis.

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

MOBILE & RESPONSIVE — EVERY PROJECT MUST WORK ON PHONE, TABLET, AND DESKTOP:
- Every HTML file must include in <head>: <meta name="viewport" content="width=device-width, initial-scale=1.0">
- Every CSS file must include: * { touch-action: manipulation; box-sizing: border-box; }
- Every button/link: -webkit-tap-highlight-color: transparent; cursor: pointer; min-height: 44px; min-width: 44px;
- Layout: use flexbox or CSS grid with flex-wrap, never fixed pixel widths for containers — use %, vw, min(), max(), clamp()
- Font sizes: use clamp() or rem — e.g. font-size: clamp(14px, 2.5vw, 18px) — never hard-code px sizes that break on small screens
- Images: always width: 100%; max-width: 100%; height: auto;
- Buttons and controls: stack vertically on small screens using flex-wrap or a @media (max-width: 480px) block
- Canvas games: always add both mouse AND touch event listeners; resize canvas on window resize
- Never use hover-only interactions — every hover state must also work on touch/tap

ARCHITECTURE PATTERNS:
- Games: game state object, requestAnimationFrame loop, separate input/update/render phases
- Dashboards: fetch → transform → render, loading/error states always
- Forms: validate on submit, show inline errors, disable during processing

GRAPHICS — NEVER USE EMOJI AS VISUAL ELEMENTS:
- Never use emoji characters (🎮🔴⭐🏠) as graphical elements, icons, or sprites in apps, games, or tools
- For icons and UI elements: use inline SVG shapes — <svg viewBox="0 0 24 24"><path .../></svg>
- For 2D characters, objects, and sprites: draw with Canvas 2D API (ctx.arc, ctx.fillRect, ctx.bezierCurveTo) or build as inline SVG
- For decorative shapes, patterns, and illustrations: use SVG <circle>, <rect>, <polygon>, <path> with gradients and filters
- For game sprites: always use Phaser graphics.generateTexture() or draw directly on Canvas — never emoji
- Emoji are only acceptable inside prose text or chat messages — never as a substitute for real graphics
- When in doubt: a colored SVG circle beats an emoji every time

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

GAME ENGINE — 2D GAMES (PHASER 3):
Use Phaser 3 for ANY game that needs physics, sprites, enemies, collectibles, or multiple scenes. Never use raw canvas game loops when Phaser applies.
CDN: <script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>

PHASER SCENE STRUCTURE — copy this exact pattern:
  class MenuScene extends Phaser.Scene {
    constructor() { super({ key: 'MenuScene' }); }
    create() {
      this.add.text(400, 280, 'GAME TITLE', { fontSize: '48px', color: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 360, 'Click to Play', { fontSize: '20px', color: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('GameScene'));
    }
  }

  class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }
    create() {
      // Always generate textures with graphics — NEVER load external image URLs
      const gfx = this.add.graphics();
      gfx.fillStyle(0x7c6af7); gfx.fillRect(0, 0, 32, 48); gfx.generateTexture('player', 32, 48); gfx.destroy();

      this.platforms = this.physics.add.staticGroup();
      const ground = this.add.rectangle(400, 568, 800, 32, 0x4a4a8a);
      this.physics.add.existing(ground, true);
      this.platforms.add(ground);

      this.player = this.physics.add.sprite(100, 450, 'player');
      this.player.setCollideWorldBounds(true);
      this.physics.add.collider(this.player, this.platforms);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', left: 'A', right: 'D', space: 'SPACE' });

      this.score = 0;
      this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '18px', color: '#fff', fontFamily: 'monospace' });
    }
    update() {
      const left = this.cursors.left.isDown || this.wasd.left.isDown;
      const right = this.cursors.right.isDown || this.wasd.right.isDown;
      const jump = this.cursors.up.isDown || this.wasd.up.isDown || this.cursors.space.isDown || this.wasd.space.isDown;
      const onGround = this.player.body.blocked.down;

      if (left) this.player.setVelocityX(-180);
      else if (right) this.player.setVelocityX(180);
      else this.player.setVelocityX(0);

      if (jump && onGround) this.player.setVelocityY(-450);
    }
  }

  class GameOverScene extends Phaser.Scene {
    constructor() { super({ key: 'GameOverScene' }); }
    create() {
      const { score } = this.scene.settings.data || { score: 0 };
      this.add.text(400, 260, 'GAME OVER', { fontSize: '48px', color: '#f87171', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 330, 'Score: ' + score, { fontSize: '24px', color: '#fff', fontFamily: 'monospace' }).setOrigin(0.5);
      this.add.text(400, 400, 'Click to Restart', { fontSize: '18px', color: '#aaa', fontFamily: 'monospace' }).setOrigin(0.5);
      this.input.once('pointerdown', () => this.scene.start('GameScene'));
    }
  }

  const config = {
    type: Phaser.AUTO,
    width: 800, height: 600,
    backgroundColor: '#1a1a2e',
    physics: { default: 'arcade', arcade: { gravity: { y: 500 }, debug: false } },
    scene: [MenuScene, GameScene, GameOverScene],
  };
  new Phaser.Game(config);

PHASER RULES:
- NEVER load external image URLs in preload() — always use graphics.generateTexture() for all sprites
- Always support arrow keys AND WASD simultaneously
- Always include MenuScene → GameScene → GameOverScene flow
- Enemies: physics.add.group(), overlap for damage, collider for solid collision
- Projectiles: group + time.addEvent for spawning, overlap(bullets, enemies, hitCallback)
- Collectibles: overlap(player, items, collectCallback), item.destroy() on collect
- Camera follow: cameras.main.startFollow(player, true)
- Timers: this.time.addEvent({ delay: 2000, callback: fn, callbackScope: this, loop: true })
- Tweens: this.tweens.add({ targets: obj, alpha: 0, duration: 300, onComplete: () => {...} })
- Pass data between scenes: this.scene.start('GameOverScene', { score: this.score })
- Sound: use Web Audio API beeps via AudioContext — never load external audio files
- Mobile: always add this.input.addPointer(1) and on-screen buttons for mobile touch

GAME ENGINE — 3D GAMES (THREE.JS + CANNON.JS PHYSICS):
For any 3D game with gravity, falling, collisions, or rigid body physics — use Cannon.js alongside Three.js.
CDN Three.js: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
CDN Cannon.js: https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js
CDN PointerLockControls: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/controls/PointerLockControls.js

CANNON.JS PHYSICS SETUP:
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  // Ground plane:
  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Dynamic box:
  const boxBody = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)) });
  boxBody.position.set(0, 5, 0); world.addBody(boxBody);

  // Sync Three.js mesh with physics body every frame:
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    world.step(1/60, delta, 3);
    mesh.position.copy(boxBody.position);
    mesh.quaternion.copy(boxBody.quaternion);
    renderer.render(scene, camera);
  }

FPS / FIRST-PERSON 3D GAME PATTERN:
  const controls = new THREE.PointerLockControls(camera, renderer.domElement);
  document.getElementById('play-btn').addEventListener('click', () => controls.lock());
  controls.addEventListener('lock', () => { /* hide menu, start game */ });
  controls.addEventListener('unlock', () => { /* show menu */ });

  // WASD movement (in animate loop, use delta time):
  const velocity = new THREE.Vector3();
  if (moveForward) velocity.z -= speed * delta;
  if (moveBackward) velocity.z += speed * delta;
  if (moveLeft) velocity.x -= speed * delta;
  if (moveRight) velocity.x += speed * delta;
  velocity.multiplyScalar(0.85); // friction
  controls.moveRight(velocity.x);
  controls.moveForward(-velocity.z);

3D GAME RULES:
- Always track delta time: const clock = new THREE.Clock(); const delta = clock.getDelta() in animate loop
- FPS games: use PointerLockControls, always show a click-to-play overlay before locking pointer
- Always add a crosshair: position:fixed; top:50%; left:50%; translate(-50%,-50%) CSS overlay
- HUD elements (health, score, ammo): position:fixed HTML divs over the canvas — never 3D text
- Player body: use CANNON.Sphere for the player collider, not a box (avoids edge-catching)
- Gravity jump: apply velocity.y = 8 upward impulse, check grounded via downward raycast
- 3D platformers: camera.position.lerp(targetPos, 0.1) for smooth third-person follow
- Always include a start screen and pointer-lock prompt before the 3D game begins

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

ICON TYPE DISAMBIGUATION — read the context before building:
- "profile icon" / "profile picture" / "avatar icon" → circular or rounded-square SVG avatar — abstract shape, initials, or illustrated face — NOT a favicon or website icon
- "app icon" / "home screen icon" → square with rounded corners (like iOS/Android), bold graphic, single strong shape, 512×512 viewBox
- "favicon" / "website icon" / "tab icon" → small 32×32 or 64×64 optimised SVG, simple enough to read tiny
- "icon" alone with no other context → ask: "What's this icon for — a profile/avatar, an app, a website tab, or a UI element?" — do NOT default to favicon
- "social media icon" → rounded square 1:1 format, designed for profile photos on platforms
- Profile icons: ALWAYS generate in full-screen square 1:1 format (e.g. viewBox="0 0 500 500", canvas 500×500) — NEVER portrait or tall format. User can crop with the built-in crop tool. Use a circle clip-path (<clipPath><circle/></clipPath>) to frame the content; include a Download PNG button
- Mobile/device mockups (Android, iPhone, phone screen): portrait frame is correct for the device shell, but MUST also show how the content looks on a desktop — include a toggle or tab to switch between mobile and desktop preview

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
- Make logos look professional: use 2-3 colors max, clean geometry, deliberate negative space

DOCUMENT GENERATION — EXPORT PDF / EXCEL / POWERPOINT / WORD:
When the user asks to export, download, or generate a document (PDF, Excel/spreadsheet, PowerPoint/slides, Word/DOCX):
- NEVER use server-side libraries or Node.js requires — always use browser CDN libraries only
- Always add a prominent "Export" button that triggers the download immediately on click
- Always wire the export button inside DOMContentLoaded with addEventListener

PDF (single page or multi-page reports):
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js"></script>
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(18); doc.text('Title', 20, 20);
  doc.setFontSize(12); doc.text('Body text here', 20, 35);
  // For tables: doc.autoTable({ head: [['Col1','Col2']], body: [['a','b']], startY: 50 });
  doc.save('output.pdf');

EXCEL / Spreadsheet:
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Name','Score'],['Alice',95],['Bob',87]]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, 'output.xlsx');
  // From HTML table: const ws = XLSX.utils.table_to_sheet(document.getElementById('table'));

POWERPOINT / Slides:
  <script src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script>
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  slide.addText('Slide Title', { x: 0.5, y: 0.5, fontSize: 28, bold: true, color: '363636' });
  slide.addText('Bullet point', { x: 0.5, y: 1.5, fontSize: 18, color: '666666' });
  // Image: slide.addImage({ path: 'url', x: 1, y: 1, w: 6, h: 3 });
  // Shape: slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.5, w: 8, h: 1, fill: { color: '0070C0' } });
  pptx.writeFile({ fileName: 'output.pptx' });

WORD / DOCX:
  <script src="https://unpkg.com/docx@8.5.0/build/index.js"></script>
  // docx runs in browser via Blob + FileSaver pattern:
  const { Document, Paragraph, TextRun, Packer } = docx;
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: 'Hello World', bold: true, size: 32 })] }),
    new Paragraph({ text: 'Normal paragraph here.' }),
  ]}]});
  Packer.toBlob(doc).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'output.docx'; a.click();
    URL.revokeObjectURL(url);
  });

RULES FOR ALL DOCUMENT EXPORTS:
- Always show a live preview of the data first (table, card, chart) then the export button below
- Style the export button prominently: background #2563eb, white text, padding 10px 24px, border-radius 6px
- After export: briefly show "✓ Downloaded!" feedback on the button for 2 seconds, then reset
- If the user provides data (a list, table, numbers): use that exact data — never invent placeholder data
- Combine export types when it makes sense: a data dashboard should offer both PDF and Excel buttons`;

const PLANNER_SYSTEM = `You are a software architect. Output ONLY a JSON array. No explanation. No markdown. Raw JSON only.

CHAT DETECTION — check this first:
If the user's message is a question, calculation, analysis, writing task, explanation request, or general conversation with NO request to build/create/make/design/animate/generate a thing — output exactly: [{"chat":true}]

CHAT examples (output [{"chat":true}]):
- "what is async/await?"
- "explain this code"
- "what's the difference between X and Y?"
- "calculate the total from this data [data follows]"
- "how much did I spend on this trip? [itinerary follows]"
- "summarise this for me"
- "translate this"
- "write me a cover letter"
- "what are the best restaurants in Tokyo?"
- Any message where the user pastes raw data (numbers, lists, itineraries, expenses, tables) and asks for totals, averages, summaries, or analysis — ALWAYS chat, NEVER an app

CODE examples (output a file plan):
- "make a cat animation"
- "create a snake game"
- "fix the button bug"
- "add dark mode"
- "build a budget tracker app"
- "make a currency converter"
- "create a trip planner tool"

KEY RULE: pasting data + asking a question = CHAT. Asking to BUILD something = CODE. Never build an app when the user just wants an answer.

EXISTING PROJECT RULE (overrides chat detection):
If the prompt ends with "Existing files: ..." — the user already has a project open. In this context:
- Short feedback like "nice", "looks good", "cool" → [{"chat":true}] (pure reaction, nothing to do)
- Anything else — "make it faster", "the button is broken", "add sound", "improve it", "what should I change?", "can you add X?" → treat as a code modification request, output a file plan
- Never tell the user to "drop a request" or act like nothing has been built

FILE LIMITS: Every file must be completable in under 600 lines. Split only when a single file would exceed that.

BUG FIXES AND CORRECTIONS:
- If existing files are provided and the request is a fix, correction, or improvement: output ONLY the files that need to change
- Do NOT include files that are already working correctly — leave them untouched
- A button fix is never a reason to regenerate a working game engine or style file
- Only include a file if you are genuinely changing something in it

ELEMENT-LEVEL CHANGES (most important rule for modifications):
- "Change the icon", "swap the logo", "replace the image", "make the button X", "change the color of Y" → output ONLY the file containing that element, change ONLY that element
- NEVER interpret "change [specific element] to X" as "rebuild the whole project with X as the theme"
- "Change the icon to a star" = find the icon in the existing files, replace just that shape/SVG/element, keep everything else identical
- "Change it to X" with existing files = surgical swap of the mentioned thing, all surrounding code stays
- If the user says "change to [thing]" without specifying what to change, ask which element they mean — do NOT regenerate the whole project

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

PHASER 3 GAMES (any 2D game with physics, enemies, collectibles, or multiple scenes):
- 1-2 files. index.html with all Phaser scenes inline is the standard — no need to split scenes into separate files unless total exceeds 600 lines.

3D GAMES (Three.js + Cannon.js, FPS, platformer, racing):
- 1-2 files. index.html with inline JS is fine for most 3D games.

MEDIUM (multi-page apps, dashboards, chat UI, large Phaser game with 4+ scenes):
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

SURGICAL EDIT RULE (when existing file content is provided):
- If you are modifying an existing file: preserve ALL code that was not mentioned in the request
- Only change the specific element, section, or value that was asked about
- "Change the icon" = replace only the icon SVG/shape/element — keep layout, styles, logic, and all other elements exactly as they were
- Do not reorganise, reformat, or improve unrelated parts while making a targeted change

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
            type: 'base64' as const,
            media_type: block.mediaType as ImageMediaType,
            data: block.data,
          },
        }
  );
  if (appendText) blocks.push({ type: 'text', text: appendText });
  return blocks;
}

async function callModel(
  prompt: any,
  systemPrompt: any,
  modelType: 'planner' | 'generator' | 'summary'
): Promise<string> {
  const hasImages = Array.isArray(prompt) && prompt.some((b: any) => b.type === 'image');

  if (!hasImages) {
    const systemText = Array.isArray(systemPrompt)
      ? systemPrompt.map((b: any) => b.text ?? '').join('\n')
      : (systemPrompt as string) ?? '';
    const userText = Array.isArray(prompt)
      ? prompt.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      : (prompt as string);
    const taskType = modelType === 'generator' ? 'chat' : 'fast_chat';
    return callPantheon(
      [{ role: 'system', content: systemText }, { role: 'user', content: userText }],
      taskType,
      modelType === 'generator' ? 16000 : 8000
    );
  }

  // Image-containing calls stay on Anthropic (vision required)
  const response = await client.messages.create({
    model: modelType === 'generator' ? 'claude-opus-4-7-20250219' : 'claude-haiku-4-5-20251001',
    max_tokens: modelType === 'generator' ? 16000 : 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = response.content[0];
  return content.type === 'text' ? content.text : '';
}

export async function POST(req: NextRequest) {
  try {
    const { messages, existingFiles, personality, memory, globalMemory: clientGlobalMemory, location } = await req.json();

    // Free tier generation gate — fail open so DB issues never block users
    const authToken = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (authToken) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(authToken);
        if (user) {
          const { data: s } = await supabaseAdmin
            .from('user_settings')
            .select('subscription_tier, generations_used, generations_reset_at')
            .eq('user_id', user.id)
            .single();

          if ((s?.subscription_tier ?? 'free') === 'free') {
            const now = new Date();
            const needsReset = !s?.generations_reset_at ||
              new Date(s.generations_reset_at).getMonth() !== now.getMonth() ||
              new Date(s.generations_reset_at).getFullYear() !== now.getFullYear();
            const used = needsReset ? 0 : (s?.generations_used ?? 0);

            if (used >= 10) {
              return NextResponse.json({ error: 'generation_limit_reached' }, { status: 402 });
            }

            void (async () => { try { await supabaseAdmin.from('user_settings').upsert({
              user_id: user.id,
              generations_used: used + 1,
              generations_reset_at: needsReset ? now.toISOString() : s.generations_reset_at,
            }, { onConflict: 'user_id' }); } catch {} })();
          }
        }
      } catch { /* fail open */ }
    }

    let globalMemory = clientGlobalMemory || '';
    if (!globalMemory) {
      try {
        const { createClient } = await import('redis');
        const redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        globalMemory = await redis.get('based_memory') ?? '';
        await redis.disconnect();
      } catch (e) {}
    }

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
    if (personality) systemBlocks.push({ type: 'text', text: `\nPERSONALITY (adjusts tone and verbosity only — never changes what action to take, never adds greetings, never delays code generation):\n${personality}` });
    if (globalMemory) systemBlocks.push({ type: 'text', text: `\nGLOBAL USER MEMORY:\n${globalMemory}` });
    if (memory) systemBlocks.push({ type: 'text', text: `\nPROJECT MEMORY:\n${memory}` });
    systemBlocks.push({ type: 'text', text: '\nCRITICAL RULE (overrides everything above): When the user asks to build, create, make, design, animate, fix, or generate anything — output forge_file code immediately. Never greet, ask clarifying questions, or refuse a code request. Go straight to the files.' });

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Step 0: Real-time context gathering
          let realtimeContext = '';
          if (process.env.TAVILY_API_KEY || process.env.OPENWEATHER_API_KEY) {
            try {
              const needsCheck = await callModel(
                `User request: "${lastUserMessage}"\n\nDoes this need real-time external data? Reply with JSON only:\n{"needsSearch":boolean,"needsWeather":boolean,"searchQuery":"...","weatherLocation":"..."}`,
                'Reply with only valid JSON. No markdown.',
                'planner'
              );
              const match = needsCheck.match(/\{[\s\S]*\}/);
              if (match) {
                const needs = JSON.parse(match[0]);
                if (needs.needsSearch && process.env.TAVILY_API_KEY && needs.searchQuery) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ searching: 'web' })}\n\n`));
                  const results = await searchWeb(needs.searchQuery);
                  if (results) realtimeContext += `\nWEB SEARCH for "${needs.searchQuery}":\n${results}`;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ searching: null })}\n\n`));
                }
                if (needs.needsWeather && process.env.OPENWEATHER_API_KEY) {
                  const loc = needs.weatherLocation
                    ? needs.weatherLocation
                    : location ?? null;
                  if (loc) {
                    const weather = await getWeather(loc);
                    if (weather) realtimeContext += `\nCURRENT WEATHER:\n${weather}`;
                  }
                }
              }
            } catch { /* fail open */ }
          }
          if (realtimeContext) {
            systemBlocks.push({ type: 'text', text: `\nREAL-TIME DATA (use this as actual data in the generated app — do not invent fake values when real data is provided):\n${realtimeContext}` });
          }

          // ── Intent clarity check (Akinator-style) ──────────────────────
          // Fast check before planning — if the request is too vague, ask one
          // clarifying question with chip options instead of guessing wrong.
          if (imageBlocks.length === 0 && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0) {
            try {
              const clarityRaw = await callPantheon(
                [
                  { role: 'system', content: `Analyze this request. Return ONLY raw JSON, no markdown or explanation.
If it is a question, calculation, analysis, or data task (not a build request) — always: {"clear":true}
If it is a build request specific enough to build directly: {"clear":true}
If it is a genuinely vague BUILD request and one question would significantly improve the result: {"clear":false,"question":"short question?","options":["Option A","Option B","Option C"]}
Options must be 2-5 words. Be very generous with "clear".
CLEAR examples: "snake game", "todo list with drag and drop", "calculate my trip expenses [data]", "what is 20% of 500", "translate this text", "write a cover letter"
VAGUE examples (only these should ever be false): "make an app", "build something cool", "a game", "a tool", "make something nice"` },
                  { role: 'user', content: lastUserMessage.trim() },
                ],
                'fast_chat',
                120
              );
              const cleaned = clarityRaw.trim().replace(/^```json|^```|```$/g, '').trim();
              const clarity = JSON.parse(cleaned);
              if (!clarity.clear && clarity.question && Array.isArray(clarity.options) && clarity.options.length >= 2) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ clarify: true, question: clarity.question, options: clarity.options.slice(0, 3) })}\n\n`));
                controller.close();
                return;
              }
            } catch {
              // If check fails for any reason, proceed with normal generation
            }
          }

          // Step 1: Planner classifies intent and plans files
          const plannerPromptContent = imageBlocks.length > 0
            ? [...imageBlocks, { type: 'text' as const, text: lastUserMessage + (existingFiles?.length ? `\n\nExisting files: ${existingFiles.map((f: any) => f.name).join(', ')}` : '') }]
            : lastUserMessage + (existingFiles?.length ? `\n\nExisting files: ${existingFiles.map((f: any) => f.name).join(', ')}` : '');

          const planText = await callModel(plannerPromptContent, PLANNER_SYSTEM_BLOCKS, 'planner');

          let filePlan: { name: string; language: string; description: string }[] = [];
          let routeToChat = false;

          try {
            const jsonMatch = planText.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : planText.trim());
            if (Array.isArray(parsed) && parsed.length === 1 && (parsed[0] as any).chat === true) {
              routeToChat = true;
            } else if (Array.isArray(parsed) && parsed.length > 0) {
              filePlan = parsed;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ plan: filePlan.map((f: any) => f.name) })}\n\n`));
            } else {
              throw new Error('empty plan');
            }
          } catch (e) {
            if (!routeToChat) {
              // Planner parse failed — stream via Pantheon (Anthropic fallback for images)
              let fullText = '';
              if (imageBlocks.length > 0) {
                const stream = await client.messages.stream({
                  model: 'claude-opus-4-7',
                  max_tokens: 16000,
                  system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
                  messages: anthropicMessages,
                });
                for await (const chunk of stream) {
                  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    fullText += chunk.delta.text;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                  }
                }
              } else {
                const sysText = systemBlocks.map(b => b.text).join('\n');
                const msgs = [{ role: 'system', content: sysText }, ...anthropicMessages.map((m: { role: string; content: unknown }) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : lastUserMessage }))];
                for await (const text of streamPantheon(msgs, 'chat', 16000)) {
                  fullText += text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
                }
              }
              const files = parseFiles(fullText);
              const projectType = parseType(fullText);
              const reply = stripTags(fullText);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, reply, files, projectType })}\n\n`));
              return;
            }
          }

          if (routeToChat) {
            let fullText = '';
            if (imageBlocks.length > 0) {
              const stream = await client.messages.stream({
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                system: systemBlocks,
                messages: anthropicMessages,
              });
              for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  fullText += chunk.delta.text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                }
              }
            } else {
              const sysText = systemBlocks.map(b => b.text).join('\n');
              const msgs = [{ role: 'system', content: sysText }, ...anthropicMessages.map((m: { role: string; content: unknown }) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : lastUserMessage }))];
              for await (const text of streamPantheon(msgs, 'chat', 4096)) {
                fullText += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
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

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`));

            const filePromptContent = imageBlocks.length > 0
              ? [...imageBlocks, { type: 'text' as const, text: filePrompt }]
              : filePrompt;

            let fileText = '';
            if (imageBlocks.length > 0) {
              // Image-containing files must use Anthropic (vision required)
              const fileStream = client.messages.stream({
                model: 'claude-opus-4-7',
                max_tokens: 16000,
                system: FILE_GENERATOR_SYSTEM_BLOCKS,
                messages: [{ role: 'user', content: filePromptContent }],
              });
              for await (const chunk of fileStream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  fileText += chunk.delta.text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
                }
              }
              const fileResult = await fileStream.finalMessage();
              if (fileResult.stop_reason === 'max_tokens' && !fileText.includes('</forge_file>')) {
                const contStream = client.messages.stream({
                  model: 'claude-opus-4-7',
                  max_tokens: 16000,
                  system: FILE_GENERATOR_SYSTEM_BLOCKS,
                  messages: [
                    { role: 'user', content: filePromptContent },
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
            } else {
              // Text-only files routed through Pantheon (multi-provider fallback)
              const msgs = [
                { role: 'system', content: FILE_GENERATOR_SYSTEM },
                { role: 'user', content: filePrompt },
              ];
              for await (const text of streamPantheon(msgs, 'chat', 16000)) {
                fileText += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
              }
            }

            const parsedFiles = parseFiles(fileText);
            const filesToAdd = parsedFiles.length > 0 ? parsedFiles : [{
              name: fileSpec.name,
              language: fileSpec.language,
              content: fileText.replace(/^<forge_file[^>]*>\n?/, '').trim() || fileText.trim(),
            }];

            const imageDataUrl = imageBlocks.length > 0
              ? `data:${imageBlocks[0].source.media_type};base64,${imageBlocks[0].source.data}`
              : null;

            for (const f of filesToAdd) {
              let content = imageDataUrl
                ? f.content.replaceAll(IMAGE_SRC_PLACEHOLDER, imageDataUrl)
                : f.content;
              generatedFiles.push(
                f.language === 'html' ? { ...f, content: sanitizeHTML(content) } : { ...f, content }
              );
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { file: fileSpec.name, current: i + 1, total: filePlan.length } })}\n\n`));
          }

          // Step 3: Brief summary — use a minimal system to avoid code-gen rules confusing haiku
          const summarySystem = 'You are Based. Reply with 1-2 plain sentences describing what was just built. No code, no forge tags, no lists.';
          const summaryPrompt = `User asked: "${lastUserMessage}"\nFiles generated: ${generatedFiles.map(f => f.name).join(', ')}\n\nDescribe what was built in 1-2 sentences.`;
          const reply = await callModel(summaryPrompt, summarySystem, 'summary')
            || `Built ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}`;

          let suggestions: string[] = [];
          try {
            const suggestText = await callModel(
              `The user just built: "${lastUserMessage}"\nFiles: ${generatedFiles.map(f => f.name).join(', ')}\n\nOutput exactly 3 short follow-up action suggestions as a JSON array. Max 5 words each. Be specific to what was built.\nExamples: ["Add dark mode", "Make it mobile-friendly", "Add sound effects"]\nJSON only, no explanation.`,
              'Output only a valid JSON array of exactly 3 short strings. No markdown.',
              'planner'
            );
            const match = suggestText.match(/\[[\s\S]*?\]/);
            if (match) suggestions = (JSON.parse(match[0]) as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 3);
          } catch {}

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, reply, files: generatedFiles, projectType, suggestions })}\n\n`));

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
