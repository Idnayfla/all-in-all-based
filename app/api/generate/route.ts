import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

SCREEN TRANSITIONS (games with a start screen, menu, or "Begin" button):
- Define ALL screens as <div class="screen" id="screen-menu">, <div class="screen" id="screen-game">, etc. in index.html
- CSS: .screen { display: none } and .screen.active { display: block } (or flex/grid)
- The Begin/Start button handler must: (1) hide the current screen by removing "active", (2) show the game screen by adding "active", (3) call the game init/start function
- The game init function must actually start the game loop — not just set a flag
- NEVER rely on CSS :active pseudo-class as the only response to a button click — that is just a press animation, not an action
- Every screen div ID used in JS must exactly match the ID written in index.html — double-check this
- Wrap the Begin button handler in try/catch and console.error any failure so silent crashes are visible

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
- Forms: validate on submit, show inline errors, disable during processing`;

const PLANNER_SYSTEM = `You are a software architect. Output ONLY a JSON array. No explanation. No markdown. Raw JSON only.

FILE LIMITS: Every file must be completable in under 600 lines. Split only when a single file would exceed that.

BUG FIXES AND CORRECTIONS:
- If existing files are provided and the request is a fix, correction, or improvement: output ONLY the files that need to change
- Do NOT include files that are already working correctly — leave them untouched
- A button fix is never a reason to regenerate a working game engine or style file
- Only include a file if you are genuinely changing something in it

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
- All JS event listeners must be inside DOMContentLoaded or placed in a deferred script
- Every button must do something visible when clicked — show a screen, start a game, play a sound
- Multi-screen games: use show/hide div sections (CSS display:none / display:block), never separate HTML files
- If generating index.html with multiple JS files: load them with <script defer src="..."> in dependency order
- Mentally trace every button click to its outcome before writing — if a path is broken, fix it

SCREEN TRANSITION PATTERN (Begin/Start/Play buttons):
- All screens are <div class="screen" id="screen-X"> in HTML; CSS hides all, .active shows the current one
- Begin button handler: remove "active" from current screen → add "active" to game screen → call startGame()
- startGame() must actually initialize and run the game (start the loop, render the first frame)
- IDs referenced in JS must exactly match IDs in the HTML — mismatches cause silent failures
- Wrap every button handler in try/catch and log errors so failures are never silent`;

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

function isCodeRequest(message: string): boolean {
  const codeKeywords = ['make', 'build', 'create', 'generate', 'code', 'write', 'develop', 'fix', 'update', 'add', 'implement', 'modify', 'change', 'edit'];
  const lower = message.toLowerCase();
  return codeKeywords.some(k => lower.includes(k));
}

export async function POST(req: NextRequest) {
  try {
    const { messages, existingFiles, personality, memory } = await req.json();

    let globalMemory = '';
    try {
      const { createClient } = await import('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      globalMemory = await redis.get('based_memory') ?? '';
      await redis.disconnect();
    } catch (e) {}

    const recentMessages = messages.slice(-10);
    const lastUserMessage = recentMessages.filter((m: any) => m.role === 'user').pop()?.content ?? '';

    const context = existingFiles?.length
      ? `\n\nCurrent project files:\n${existingFiles.map((f: any) => `--- ${f.name} (${f.language}) ---\n${f.content}`).join('\n\n')}`
      : '';

    const anthropicMessages = recentMessages.map((m: any, i: number) => ({
      role: m.role,
      content: i === recentMessages.length - 1 && m.role === 'user'
        ? m.content + context
        : m.content,
    }));

    const fullSystem = `${personality ? personality + '\n\n' : ''}${SYSTEM}${globalMemory ? `\n\nGLOBAL USER MEMORY:\n${globalMemory}` : ''}${memory ? `\n\nPROJECT MEMORY:\n${memory}` : ''}`;

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Check if this is a code generation request
          if (!isCodeRequest(lastUserMessage)) {
            const stream = await client.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 4096,
              system: fullSystem,
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

          // Step 1: Plan files silently
          const plannerResponse = await client.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 1024,
            system: PLANNER_SYSTEM,
            messages: [{ role: 'user', content: lastUserMessage + (existingFiles?.length ? `\n\nExisting files: ${existingFiles.map((f: any) => f.name).join(', ')}` : '') }],
          });

          let filePlan: { name: string; language: string; description: string }[] = [];
          try {
            const planText = plannerResponse.content[0].type === 'text' ? plannerResponse.content[0].text : '[]';
            // Extract JSON array even when the model wraps it in a markdown code fence
            const jsonMatch = planText.match(/\[[\s\S]*\]/);
            filePlan = JSON.parse(jsonMatch ? jsonMatch[0] : planText.trim());
            if (!Array.isArray(filePlan) || filePlan.length === 0) throw new Error('empty plan');
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ plan: filePlan.map((f: any) => f.name) })}\n\n`));
          } catch (e) {
            // Fallback to single request
            const stream = await client.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 16000,
              system: fullSystem,
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

            const filePrompt = `Project: ${lastUserMessage}

Generate file: ${fileSpec.name}
Purpose: ${fileSpec.description}
Language: ${fileSpec.language}

All project files: ${filePlan.map(f => `${f.name} — ${f.description}`).join('\n')}
${generatedContext}${existingContext}

Generate ONLY ${fileSpec.name}, complete with no placeholders.`;

            // Send structured progress event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress: { current: i + 1, total: filePlan.length, file: fileSpec.name } })}\n\n`));

            const fileStream = client.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 16000,
              system: FILE_GENERATOR_SYSTEM,
              messages: [{ role: 'user', content: filePrompt }],
            });

            let fileText = '';
            for await (const chunk of fileStream) {
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                fileText += chunk.delta.text;
                // Forward chunks to keep the connection alive (client ignores forge_file content visually)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`));
              }
            }
            const fileResult = await fileStream.finalMessage();

            // If the model was cut off before closing the forge_file tag, continue from where it stopped
            if (fileResult.stop_reason === 'max_tokens' && !fileText.includes('</forge_file>')) {
              const contStream = client.messages.stream({
                model: 'claude-opus-4-6',
                max_tokens: 16000,
                system: FILE_GENERATOR_SYSTEM,
                messages: [
                  { role: 'user', content: filePrompt },
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
            if (parsedFiles.length > 0) {
              generatedFiles.push(...parsedFiles);
            } else {
              // Strip the forge_file opening tag if the file was truncated before the closing tag
              const rawContent = fileText.replace(/^<forge_file[^>]*>\n?/, '').trim();
              generatedFiles.push({
                name: fileSpec.name,
                language: fileSpec.language,
                content: rawContent || fileText.trim(),
              });
            }
          }

          // Step 3: Brief summary
          const summaryResponse = await client.messages.create({
            model: 'claude-opus-4-6',
            max_tokens: 200,
            system: fullSystem,
            messages: [
              { role: 'user', content: lastUserMessage },
              { role: 'assistant', content: `Generated ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}` },
              { role: 'user', content: 'Give a 1-2 sentence summary of what was built.' }
            ],
          });

          const reply = summaryResponse.content[0].type === 'text'
            ? summaryResponse.content[0].text
            : `Built ${generatedFiles.length} files: ${generatedFiles.map(f => f.name).join(', ')}`;

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
