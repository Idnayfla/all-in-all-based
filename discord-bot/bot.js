#!/usr/bin/env node
/**
 * Based HQ — Agentic Discord Bot
 *
 * Agents can:
 *   - Search the web in real-time
 *   - Read and write files in the codebase
 *   - Run shell commands (npm, git, etc.)
 *   - Search through the codebase
 *   - Consult other specialist agents mid-response
 *   - Create GitHub issues
 *   - Get git status / recent commits
 *
 * Setup:
 *   1. discord.com/developers → New App → Bot → copy Token
 *   2. Bot tab → enable MESSAGE CONTENT INTENT
 *   3. OAuth2 → URL Generator → bot scope → Send Messages + Read Message History
 *   4. Copy config.example.json → config.json, fill in values
 *   5. npm install && node bot.js
 *
 * Run always-on (Pi):
 *   npm install -g pm2
 *   pm2 start bot.js --name based-hq && pm2 save && pm2 startup
 *
 * Commands in any agent channel:
 *   !clear   — reset conversation history
 *   !help    — list all agents + tools
 *   !status  — uptime + model info
 */

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\nERROR: config.json not found.');
  console.error('Run: cp config.example.json config.json  and fill in your values.\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const PROJECT_ROOT = config.project_root || path.join(__dirname, '..');

// ── Agent registry ────────────────────────────────────────────────────────
const AGENTS = {
  orchestrator:       { name: 'Orchestrator',      icon: '◉', opus: true  },
  architect:          { name: 'Architect',          icon: '⬡', opus: true  },
  'senior-engineer':  { name: 'Senior Engineer',    icon: '◈', opus: true  },
  'ai-engineer':      { name: 'AI Engineer',        icon: '⊙', opus: true  },
  product:            { name: 'Product',            icon: '◈', opus: false },
  designer:           { name: 'Designer',           icon: '◉', opus: false },
  devops:             { name: 'DevOps',             icon: '⬡', opus: false },
  security:           { name: 'Security',           icon: '◈', opus: false },
  qa:                 { name: 'QA',                 icon: '⊙', opus: false },
  growth:             { name: 'Growth',             icon: '◉', opus: false },
  'data-analyst':     { name: 'Data Analyst',       icon: '⬡', opus: false },
  mobile:             { name: 'Mobile',             icon: '◈', opus: false },
  finance:            { name: 'Finance',            icon: '◉', opus: false },
  legal:              { name: 'Legal',              icon: '⊙', opus: false },
  community:          { name: 'Community',          icon: '⬡', opus: false },
  'chief-of-staff':   { name: 'Chief of Staff',     icon: '◈', opus: false },
  'technical-writer': { name: 'Technical Writer',   icon: '◉', opus: false },
};

const MODEL_OPUS   = config.model_opus   || 'claude-opus-4-8';
const MODEL_SONNET = config.model_sonnet || 'claude-sonnet-4-6';

// ── Clients ───────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const anthropic = new Anthropic({ apiKey: config.anthropic_api_key });

// ── Conversation histories ────────────────────────────────────────────────
const histories = new Map(); // channelId → Message[]

// ── System prompt loader ──────────────────────────────────────────────────
const DISCORD_ADDENDUM = `

---
You are operating inside Based HQ — a private Discord workspace. You have access to powerful tools:
use them proactively. Don't just advise — act. Read files before commenting on code. Search the web
before answering questions about live data. Consult specialists when a question crosses domains.
Use Discord markdown. Keep text concise; let tool outputs speak for themselves.`;

function loadSystemPrompt(slug) {
  const agentsDir = config.agents_dir || path.join(PROJECT_ROOT, '.claude', 'agents');
  try {
    return fs.readFileSync(path.join(agentsDir, `${slug}.md`), 'utf-8') + DISCORD_ADDENDUM;
  } catch {
    return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.${DISCORD_ADDENDUM}`;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for live information — docs, prices, news, anything current.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'consult_agent',
    description: 'Get a specialist opinion from another agent. Use when the question crosses your domain.',
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: `Agent slug. Options: ${Object.keys(AGENTS).filter(s => s !== 'orchestrator').join(', ')}`,
        },
        question: { type: 'string', description: 'The specific question to ask the specialist.' },
      },
      required: ['agent', 'question'],
    },
  },
  {
    name: 'read_file',
    description: 'Read any file in the codebase.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the codebase. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path relative to project root.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root (git, npm, grep, etc.). 30s timeout.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_codebase',
    description: 'Search for a pattern across all source files. Returns matching file paths and lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern:  { type: 'string', description: 'Text or regex to search for.' },
        dir:      { type: 'string', description: 'Optional subdirectory to search in.' },
        file_ext: { type: 'string', description: 'Optional file extension filter (e.g. ts, tsx, js).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to project root.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_git_info',
    description: 'Get git status, recent commits, or diff.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['status', 'log', 'diff'],
          description: 'What to retrieve.',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'create_github_issue',
    description: 'Create a GitHub issue in the repo. Requires gh CLI authenticated.',
    input_schema: {
      type: 'object',
      properties: {
        title:  { type: 'string' },
        body:   { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'body'],
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────
function safeResolvePath(filePath) {
  const abs = path.resolve(PROJECT_ROOT, filePath);
  if (!abs.startsWith(PROJECT_ROOT)) throw new Error('Path outside project root — access denied.');
  return abs;
}

async function toolWebSearch({ query }) {
  const key = config.exa_api_key;
  if (!key) return 'Web search not configured. Add exa_api_key to config.json (get one at exa.ai).';
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, numResults: 5, useAutoprompt: true, type: 'neural', contents: { text: { maxCharacters: 400 } } }),
  });
  if (!res.ok) return `Search failed: HTTP ${res.status}`;
  const data = await res.json();
  if (!data.results?.length) return 'No results found.';
  return data.results
    .map(r => `**${r.title}**\n${r.url}\n${r.text?.slice(0, 350) || ''}`)
    .join('\n\n---\n\n');
}

async function toolConsultAgent({ agent, question }, context) {
  if (!AGENTS[agent]) return `Unknown agent slug: ${agent}`;
  if (agent === context.currentAgent) return 'An agent cannot consult itself.';
  if ((context.consultDepth || 0) >= 2) return 'Max consultation depth reached (2 levels).';
  const msgs = [{ role: 'user', content: question }];
  const reply = await runAgentLoop(agent, msgs, { ...context, consultDepth: (context.consultDepth || 0) + 1 });
  return `**${AGENTS[agent].icon} ${AGENTS[agent].name}:**\n${reply}`;
}

function toolReadFile({ path: filePath }) {
  const abs = safeResolvePath(filePath);
  if (!fs.existsSync(abs)) return `File not found: ${filePath}`;
  const content = fs.readFileSync(abs, 'utf-8');
  if (content.length > 10000) return content.slice(0, 10000) + `\n\n[truncated — ${content.length} total chars]`;
  return content;
}

function toolWriteFile({ path: filePath, content }) {
  const abs = safeResolvePath(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return `Written ${content.length} chars to ${filePath}`;
}

function toolRunCommand({ command }) {
  try {
    const out = execSync(command, {
      cwd: PROJECT_ROOT,
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = (out || '').trim();
    return result.slice(0, 3000) || '(command completed with no output)';
  } catch (err) {
    const msg = ((err.stdout || '') + (err.stderr || '') || err.message || '').trim();
    return `Exit ${err.status ?? 1}:\n${msg.slice(0, 2000)}`;
  }
}

function toolSearchCodebase({ pattern, dir, file_ext }) {
  const target = dir ? path.join(PROJECT_ROOT, dir) : PROJECT_ROOT;
  const extFlag = file_ext
    ? `--include="*.${file_ext}"`
    : '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.json"';
  try {
    const result = execSync(
      `grep -rn "${pattern.replace(/"/g, '\\"')}" "${target}" ${extFlag} --max-count=3 2>/dev/null | head -40`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return result.trim() || 'No matches found.';
  } catch {
    return 'No matches found.';
  }
}

function toolListFiles({ path: dirPath }) {
  const abs = safeResolvePath(dirPath || '.');
  if (!fs.existsSync(abs)) return `Directory not found: ${dirPath}`;
  const items = fs.readdirSync(abs, { withFileTypes: true });
  return items
    .filter(i => i.name !== 'node_modules' && !i.name.startsWith('.node'))
    .map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`)
    .join('\n') || '(empty directory)';
}

function toolGetGitInfo({ type }) {
  const cmds = { status: 'git status --short', log: 'git log --oneline -15', diff: 'git diff --stat HEAD~1' };
  try {
    return execSync(cmds[type] || 'git status', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim() || '(clean)';
  } catch (err) {
    return `git error: ${err.message}`;
  }
}

async function toolCreateGithubIssue({ title, body, labels = [] }) {
  const labelFlag = labels.length ? `--label "${labels.join(',')}"` : '';
  const safeTitle = title.replace(/"/g, '\\"').replace(/`/g, '\\`');
  const safeBody  = body.replace(/"/g, '\\"').replace(/`/g, '\\`');
  try {
    const out = execSync(
      `gh issue create --title "${safeTitle}" --body "${safeBody}" ${labelFlag}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    return `Issue created: ${out.trim()}`;
  } catch (err) {
    return `Failed to create issue: ${(err.stderr || err.message || '').slice(0, 500)}`;
  }
}

async function executeTool(name, input, context) {
  const tools = {
    web_search:           () => toolWebSearch(input),
    consult_agent:        () => toolConsultAgent(input, context),
    read_file:            () => toolReadFile(input),
    write_file:           () => toolWriteFile(input),
    run_command:          () => toolRunCommand(input),
    search_codebase:      () => toolSearchCodebase(input),
    list_files:           () => toolListFiles(input),
    get_git_info:         () => toolGetGitInfo(input),
    create_github_issue:  () => toolCreateGithubIssue(input),
  };
  try {
    return String(await (tools[name] ?? (() => `Unknown tool: ${name}`))());
  } catch (err) {
    return `Tool error (${name}): ${err.message}`;
  }
}

// ── Agentic loop ──────────────────────────────────────────────────────────
async function runAgentLoop(slug, messages, context = {}, depth = 0) {
  if (depth > 12) return '[Max reasoning depth reached — stopping to avoid infinite loop]';

  const agent  = AGENTS[slug];
  const model  = agent?.opus ? MODEL_OPUS : MODEL_SONNET;
  const system = loadSystemPrompt(slug);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages,
    tools: TOOL_DEFINITIONS,
    tool_choice: { type: 'auto' },
  });

  if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
  }

  if (response.stop_reason === 'tool_use') {
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');

    const toolResults = await Promise.all(
      toolBlocks.map(async block => ({
        type: 'tool_result',
        tool_use_id: block.id,
        content: await executeTool(block.name, block.input, { ...context, currentAgent: slug }),
      }))
    );

    const next = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];

    return runAgentLoop(slug, next, context, depth + 1);
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return text || '[No response]';
}

// ── Discord utilities ─────────────────────────────────────────────────────
function splitMessage(text, max = 1900) {
  if (text.length <= max) return [text];
  const parts = [];
  let rem = text;
  while (rem.length > max) {
    let cut = rem.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = max;
    parts.push(rem.slice(0, cut));
    rem = rem.slice(cut).trimStart();
  }
  if (rem) parts.push(rem);
  return parts;
}

function startTyping(channel) {
  channel.sendTyping().catch(() => {});
  return setInterval(() => channel.sendTyping().catch(() => {}), 8000);
}

// ── Message handler ───────────────────────────────────────────────────────
discord.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.author.id !== config.authorized_user_id) return;

  const channelName = message.channel.name?.toLowerCase() ?? '';
  const content     = message.content.trim();
  if (!content) return;

  // Built-in commands
  if (content === '!clear') {
    histories.delete(message.channel.id);
    await message.reply('◈ Conversation cleared.');
    return;
  }

  if (content === '!status') {
    const up = Math.floor(process.uptime());
    await message.reply(
      `**◈ Based HQ**\n` +
      `Uptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${up%60}s\n` +
      `Active histories: ${histories.size}\n` +
      `Opus: \`${MODEL_OPUS}\` · Sonnet: \`${MODEL_SONNET}\`\n` +
      `Project root: \`${PROJECT_ROOT}\``
    );
    return;
  }

  if (content === '!help') {
    const list = Object.entries(AGENTS)
      .map(([slug, { name, icon, opus }]) => `${icon} **#${slug}** — ${name}${opus ? ' *(Opus)*' : ''}`)
      .join('\n');
    const tools = TOOL_DEFINITIONS.map(t => `\`${t.name}\``).join(' · ');
    await message.reply(
      `**◈ Based HQ — Your Team**\n\n${list}\n\n` +
      `**Tools every agent can use:**\n${tools}\n\n` +
      `**Commands:** \`!clear\` · \`!help\` · \`!status\``
    );
    return;
  }

  // Route by channel name
  const agentSlug = Object.keys(AGENTS).find(s => channelName === s);
  if (!agentSlug) return;

  const channelId = message.channel.id;
  if (!histories.has(channelId)) histories.set(channelId, []);
  const history = histories.get(channelId);

  history.push({ role: 'user', content });

  const typing = startTyping(message.channel);

  try {
    const reply = await runAgentLoop(agentSlug, [...history]);

    if (!reply) {
      clearInterval(typing);
      await message.reply('No response received. Try again.');
      return;
    }

    history.push({ role: 'assistant', content: reply });
    while (history.length > 20) history.shift();

    clearInterval(typing);
    const parts = splitMessage(reply);
    await message.reply(parts[0]);
    for (const part of parts.slice(1)) {
      await message.channel.send(part);
    }

  } catch (err) {
    clearInterval(typing);
    console.error(`[${agentSlug}]`, err);
    await message.reply(`◈ Error: ${(err.message || 'Something went wrong').slice(0, 200)}`);
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────
discord.once('ready', () => {
  console.log(`\n◈ Based HQ online  →  ${discord.user.tag}`);
  console.log(`  Authorized : ${config.authorized_user_id}`);
  console.log(`  Opus       : ${MODEL_OPUS}`);
  console.log(`  Sonnet     : ${MODEL_SONNET}`);
  console.log(`  Root       : ${PROJECT_ROOT}`);
  console.log(`  Tools      : ${TOOL_DEFINITIONS.map(t => t.name).join(', ')}`);
  console.log(`\n  Ready. Say something in an agent channel.\n`);
  discord.user.setActivity('Based HQ', { type: ActivityType.Watching });
});

discord.on('error',   err => console.error('Discord error:', err));
discord.on('warn',    msg => console.warn('Discord warn:', msg));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

discord.login(config.discord_token);
