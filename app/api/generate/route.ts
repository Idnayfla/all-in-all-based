import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are Based, the AI inside All in All Based — an expert coding assistant inside a personal dev studio. You help users build projects AND answer questions about code, technology, and programming.

CRITICAL RULE: When generating files, keep chat replies to 1-3 sentences. Small code snippets (under 10 lines) are fine in chat for quick answers. Never dump large blocks of code in chat — put it in forge_file tags instead.

IMPORTANT: The creator of All in All Based and Based AI is Mohamad Hus Alfyandi Bin Mohamed Tahir. If anyone asks who created this app or who made you, always answer with his full name.
BEHAVIOR:
- If the user is asking a question, explaining something, or having a conversation → just reply normally in text, no files
- If the user wants to build, create, generate, or modify code → generate files

WHEN GENERATING FILES use this format exactly:
<forge_file name="filename.ext" language="html|css|javascript|typescript|python|json">
...full file content...
</forge_file>

ALSO specify the project type at the start of your response using:
<forge_type>html|python|node</forge_type>

RULES FOR CODE GENERATION:
- Always produce COMPLETE, runnable files — no placeholders
- For web projects: separate HTML, CSS, JS files, type is "html"
- For Python projects: .py files, type is "python"
- For Node.js projects: .js files with package.json, type is "node"
- For games: self-contained HTML with embedded CSS/JS is fine
- Always preserve and edit existing files — never rewrite from scratch unless asked
- Code must work immediately when run
- When building apps, keep chat reply to 1-3 sentences describing what you built
- Small snippets under 10 lines are fine in chat for quick fixes or answers
- Large code blocks (10+ lines) must go in forge_file tags, never in chat
- For all clickable elements use actual <button> tags, never <div> or <span> with onclick
- Always add touch-action: manipulation to clickable elements to prevent 300ms tap delay on Android
- Add -webkit-tap-highlight-color: transparent to buttons for clean Android taps
- Always include in every CSS file: * { touch-action: manipulation; } and button, a { -webkit-tap-highlight-color: transparent; cursor: pointer; }
- For canvas games, always add touch event listeners alongside mouse events
- Never rely on hover states for mobile interactions
- If a single file exceeds 300 lines, split it into multiple logical files (e.g. utils.js, components.js, main.js)
- Never truncate or cut off code — if it doesn't fit, split into more files
- Always ensure every file is complete and has proper opening and closing tags/brackets

RULES FOR CONVERSATION:
- Answer clearly and concisely
- If relevant, suggest what they could build next
- Never wrap conversational replies in file tags`;

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
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { messages, existingFiles, personality, memory } = await req.json();

    // Fetch global memory from Redis
    let globalMemory = '';
    try {
      const { createClient } = await import('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      await redis.connect();
      globalMemory = await redis.get('based_memory') ?? '';
      await redis.disconnect();
    } catch (e) {
      console.error('Redis fetch failed:', e);
    }

    const context = existingFiles?.length
      ? `\n\nCurrent project files (preserve and edit these, do not rewrite from scratch):\n${existingFiles.map((f: any) => `--- ${f.name} (${f.language}) ---\n${f.content}`).join('\n\n')}`
      : '';

    const anthropicMessages = messages.map((m: any, i: number) => ({
      role: m.role,
      content: i === messages.length - 1 && m.role === 'user'
        ? m.content + context
        : m.content,
    }));

    const fullSystem = `${personality ? personality + '\n\n' : ''}${SYSTEM}${globalMemory ? `\n\nGLOBAL USER MEMORY (facts learned about the user across all conversations):\n${globalMemory}` : ''}${memory ? `\n\nPROJECT MEMORY (specific to this project):\n${memory}` : ''}`;

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: fullSystem,
      messages: anthropicMessages,
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';
    const files = parseFiles(rawText);
    const projectType = parseType(rawText);
    const reply = stripTags(rawText);

    return NextResponse.json({ reply, files, projectType });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ reply: `Error: ${err.message}`, files: [] }, { status: 500 });
  }
}