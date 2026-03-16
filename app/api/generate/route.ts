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

BUG FIXING RULES:
- When fixing bugs: ALWAYS rewrite ALL files completely from scratch
- Never do partial edits
- If a bug has been attempted before: completely rethink the approach
- Before fixing: state the root cause. After fixing: state what changed.

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

FILE LIMITS: Every file must be completable in under 600 lines.

For ANY game request, plan these exact files:
- index.html — HTML structure only, links to all JS/CSS
- style.css — all styling, animations, UI components
- rooms.js — all room definitions, map data, note texts, item placements
- entities.js — monster AI, entity creation, interaction handlers, chase sequences
- audio.js — all audio management, Web Audio API, sound effects
- ui.js — HUD updates, inventory screen, dialogue box, notifications, safe input, death/win screens
- game.js — game state, constants, player object, input system, camera, room loading, transitions, event system
- engine.js — game loop, requestAnimationFrame, all canvas render/draw functions, canvas setup, resize

For non-game web apps: index.html, style.css, app.js, utils.js minimum.
For Python: main.py and supporting modules.

Output format:
[{"name":"index.html","language":"html","description":"..."},{"name":"style.css","language":"css","description":"..."},{"name":"rooms.js","language":"javascript","description":"..."},{"name":"entities.js","language":"javascript","description":"..."},{"name":"audio.js","language":"javascript","description":"..."},{"name":"ui.js","language":"javascript","description":"..."},{"name":"game.js","language":"javascript","description":"..."},{"name":"engine.js","language":"javascript","description":"..."}]`;

const FILE_GENERATOR_SYSTEM = `You are Based, an elite coding assistant. Generate ONE file as part of a larger project.

Output ONLY the file content inside forge_file tags. Nothing else.

Format:
<forge_file name="FILENAME" language="LANGUAGE">
...complete file content...
</forge_file>

CRITICAL RULES:
- Hard limit: 600 lines maximum per file
- rooms.js: ONLY the first 4 rooms maximum. Do not define more than 4 rooms in this file.
- rooms2.js: remaining rooms if more than 4 exist
- entities.js: ONLY monster AI, entity factory, interaction handlers, chase logic — nothing else
- audio.js: ONLY Web Audio API setup and all sound functions — nothing else
- ui.js: ONLY DOM manipulation, HUD updates, inventory, dialogue, overlays — nothing else
- game.js: ONLY game state object, constants, player object, input system, camera — stop after camera, do NOT include room loader or event system
- events.js: ONLY room loader, transition logic, event system, trigger handlers
- engine.js: ONLY game loop, requestAnimationFrame, all draw/render functions, canvas init — NO game logic
- No placeholders, no TODOs, no truncation
- Assume all other files are loaded before this one`;

function parseFiles(text: string) {
  const regex = /<forge_file name="([^"]+)" language="([^"]+)">([\s\S]*?)<\/forge_file>/g;
  const files = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({ name: match[1], language: match[2], content: match[3].trim() });
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
            filePlan = JSON.parse(planText.trim());
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: `\n📋 Plan: ${filePlan.map((f: any) => f.name).join(', ')}\n` })}\n\n`));
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

            // Send progress update
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: `\n⚙️ Generating ${fileSpec.name} (${i + 1}/${filePlan.length})...\n` })}\n\n`));

            const fileStream = await client.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 16000,
              system: FILE_GENERATOR_SYSTEM,
              messages: [{ role: 'user', content: filePrompt }],
            });

            let fileText = '';
            for await (const chunk of fileStream) {
              if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                fileText += chunk.delta.text;
              }
            }

            const parsedFiles = parseFiles(fileText);
            if (parsedFiles.length > 0) {
              generatedFiles.push(...parsedFiles);
            } else {
              generatedFiles.push({
                name: fileSpec.name,
                language: fileSpec.language,
                content: fileText.trim()
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
