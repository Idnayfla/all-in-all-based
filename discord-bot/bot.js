#!/usr/bin/env node
/**
 * Based HQ — Agentic Discord Bot
 *
 * Provider routing (configurable via config.json):
 *   "auto"      — Groq (free) for most agents, Anthropic for senior 4 (default)
 *   "groq"      — Groq for everything (fully free, ~450ms)
 *   "anthropic" — Anthropic for everything (pay-as-you-go)
 *
 * Senior agents that always use Anthropic in "auto" mode:
 *   orchestrator, architect, senior-engineer, ai-engineer
 *
 * All agents have tools: web_search, consult_agent, read_file, write_file,
 *   run_command, search_codebase, list_files, get_git_info, create_github_issue
 *
 * Setup:
 *   1. discord.com/developers → New App → Bot → copy Token
 *   2. Bot tab → enable MESSAGE CONTENT INTENT
 *   3. OAuth2 → URL Generator → scope: bot → permissions: Send Messages + Read Message History
 *   4. Copy generated URL → invite bot to your server
 *   5. cp config.example.json config.json → fill in values
 *   6. npm install && node bot.js
 *
 * Run always-on (Pi):
 *   npm install -g pm2
 *   pm2 start bot.js --name based-hq && pm2 save && pm2 startup
 *
 * Commands in any agent channel:
 *   !clear    — reset conversation history for that channel
 *   !help     — list agents + tools
 *   !status   — uptime, provider, model info
 */

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const Groq      = require('groq-sdk');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('\nERROR: config.json not found. Run: cp config.example.json config.json\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const PROJECT_ROOT = config.project_root || path.join(__dirname, '..');
const PROVIDER     = config.provider || 'auto';  // 'auto' | 'groq' | 'anthropic'

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

const MODEL_ANTHROPIC_OPUS   = config.model_opus    || 'claude-opus-4-8';
const MODEL_ANTHROPIC_SONNET = config.model_sonnet  || 'claude-sonnet-4-6';
const MODEL_GROQ              = config.model_groq   || 'llama-3.3-70b-versatile';

// ── LLM Clients ───────────────────────────────────────────────────────────
const anthropic = config.anthropic_api_key
  ? new Anthropic({ apiKey: config.anthropic_api_key })
  : null;

const groq = config.groq_api_key
  ? new Groq({ apiKey: config.groq_api_key })
  : null;

// ── Discord client ────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Conversation histories (per channel) ──────────────────────────────────
const histories = new Map();

// ── System prompt loader ──────────────────────────────────────────────────
const ADDENDUM = `

---
You are inside Based HQ — a private Discord server. You have tools — use them proactively.
Don't just advise: act. Read files before commenting on code. Search the web for live data.
Consult specialists when questions cross your domain. Use Discord markdown. Be concise.`;

function loadSystemPrompt(slug) {
  const dir = config.agents_dir || path.join(PROJECT_ROOT, '.claude', 'agents');
  try {
    return fs.readFileSync(path.join(dir, `${slug}.md`), 'utf-8') + ADDENDUM;
  } catch {
    return `You are the ${AGENTS[slug]?.name || slug} specialist for Based AI studio.${ADDENDUM}`;
  }
}

// ── Tool definitions (Anthropic format — converted for Groq below) ─────────
const TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for live information — docs, prices, news, anything current.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'consult_agent',
    description: 'Get a specialist opinion from another agent. Use when the question crosses your domain.',
    input_schema: {
      type: 'object',
      properties: {
        agent:    { type: 'string', description: `Agent slug. Options: ${Object.keys(AGENTS).filter(s => s !== 'orchestrator').join(', ')}` },
        question: { type: 'string', description: 'Specific question to ask the specialist.' },
      },
      required: ['agent', 'question'],
    },
  },
  {
    name: 'read_file',
    description: 'Read any file in the codebase.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to project root.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file. Creates parent directories if needed.',
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
      properties: { command: { type: 'string', description: 'Shell command to execute.' } },
      required: ['command'],
    },
  },
  {
    name: 'search_codebase',
    description: 'Search for a pattern across all source files.',
    input_schema: {
      type: 'object',
      properties: {
        pattern:  { type: 'string', description: 'Text or regex to search for.' },
        dir:      { type: 'string', description: 'Optional subdirectory to search in.' },
        file_ext: { type: 'string', description: 'Optional file extension (e.g. ts, js).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path relative to project root.' } },
      required: ['path'],
    },
  },
  {
    name: 'get_git_info',
    description: 'Get git status, recent commits, or diff.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['status', 'log', 'diff'], description: 'What to retrieve.' } },
      required: ['type'],
    },
  },
  {
    name: 'create_github_issue',
    description: 'Create a GitHub issue. Requires gh CLI authenticated.',
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
function safePath(p) {
  const abs = path.resolve(PROJECT_ROOT, p);
  if (!abs.startsWith(PROJECT_ROOT)) throw new Error('Path outside project root.');
  return abs;
}

async function toolWebSearch({ query }) {
  const key = config.exa_api_key;
  if (!key) return 'Web search not configured. Add exa_api_key to config.json';
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, numResults: 5, useAutoprompt: true, type: 'neural', contents: { text: { maxCharacters: 350 } } }),
  });
  if (!res.ok) return `Search failed: HTTP ${res.status}`;
  const data = await res.json();
  if (!data.results?.length) return 'No results.';
  return data.results.map(r => `**${r.title}**\n${r.url}\n${r.text?.slice(0, 300) || ''}`).join('\n\n---\n\n');
}

async function toolConsultAgent({ agent, question }, context) {
  if (!AGENTS[agent]) return `Unknown agent: ${agent}`;
  if (agent === context.currentAgent) return 'Cannot consult yourself.';
  if ((context.consultDepth || 0) >= 2) return 'Max consultation depth (2).';
  const reply = await dispatchAgent(agent, [{ role: 'user', content: question }], {
    ...context,
    consultDepth: (context.consultDepth || 0) + 1,
  });
  return `**${AGENTS[agent].icon} ${AGENTS[agent].name}:**\n${reply}`;
}

function toolReadFile({ path: p }) {
  const abs = safePath(p);
  if (!fs.existsSync(abs)) return `Not found: ${p}`;
  const c = fs.readFileSync(abs, 'utf-8');
  return c.length > 10000 ? c.slice(0, 10000) + '\n[truncated]' : c;
}

function toolWriteFile({ path: p, content }) {
  const abs = safePath(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return `Written ${content.length} chars to ${p}`;
}

function toolRunCommand({ command }) {
  try {
    const out = execSync(command, { cwd: PROJECT_ROOT, timeout: 30000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return (out || '').trim().slice(0, 3000) || '(no output)';
  } catch (err) {
    return `Exit ${err.status ?? 1}: ${((err.stdout || '') + (err.stderr || '') || err.message).trim().slice(0, 2000)}`;
  }
}

function toolSearchCodebase({ pattern, dir, file_ext }) {
  const target = dir ? path.join(PROJECT_ROOT, dir) : PROJECT_ROOT;
  const ext = file_ext ? `--include="*.${file_ext}"` : '--include="*.ts" --include="*.tsx" --include="*.js"';
  try {
    return execSync(
      `grep -rn "${pattern.replace(/"/g, '\\"')}" "${target}" ${ext} --max-count=3 2>/dev/null | head -40`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim() || 'No matches.';
  } catch { return 'No matches.'; }
}

function toolListFiles({ path: p }) {
  const abs = safePath(p || '.');
  if (!fs.existsSync(abs)) return `Not found: ${p}`;
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter(i => i.name !== 'node_modules')
    .map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`)
    .join('\n') || '(empty)';
}

function toolGetGitInfo({ type }) {
  const cmds = { status: 'git status --short', log: 'git log --oneline -15', diff: 'git diff --stat HEAD~1' };
  try {
    return execSync(cmds[type] || 'git status', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim() || '(clean)';
  } catch (e) { return `git error: ${e.message}`; }
}

async function toolCreateGithubIssue({ title, body, labels = [] }) {
  const lf = labels.length ? `--label "${labels.join(',')}"` : '';
  try {
    const out = execSync(
      `gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" ${lf}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    return `Created: ${out.trim()}`;
  } catch (e) { return `Failed: ${(e.stderr || e.message || '').slice(0, 400)}`; }
}

async function executeTool(name, input, context) {
  try {
    switch (name) {
      case 'web_search':          return await toolWebSearch(input);
      case 'consult_agent':       return await toolConsultAgent(input, context);
      case 'read_file':           return toolReadFile(input);
      case 'write_file':          return toolWriteFile(input);
      case 'run_command':         return toolRunCommand(input);
      case 'search_codebase':     return toolSearchCodebase(input);
      case 'list_files':          return toolListFiles(input);
      case 'get_git_info':        return toolGetGitInfo(input);
      case 'create_github_issue': return await toolCreateGithubIssue(input);
      default:                    return `Unknown tool: ${name}`;
    }
  } catch (e) { return `Tool error (${name}): ${e.message}`; }
}

// ── Anthropic agentic loop ────────────────────────────────────────────────
async function runAnthropicLoop(slug, messages, context = {}, depth = 0) {
  if (depth > 12) return '[Max depth reached]';
  const agent  = AGENTS[slug];
  const model  = agent?.opus ? MODEL_ANTHROPIC_OPUS : MODEL_ANTHROPIC_SONNET;
  const system = loadSystemPrompt(slug);

  const res = await anthropic.messages.create({
    model, max_tokens: 4096, system, messages,
    tools: TOOL_DEFINITIONS, tool_choice: { type: 'auto' },
  });

  if (res.stop_reason !== 'tool_use') {
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }

  const toolBlocks = res.content.filter(b => b.type === 'tool_use');
  const results = await Promise.all(toolBlocks.map(async b => ({
    type: 'tool_result',
    tool_use_id: b.id,
    content: String(await executeTool(b.name, b.input, { ...context, currentAgent: slug })),
  })));

  return runAnthropicLoop(slug, [
    ...messages,
    { role: 'assistant', content: res.content },
    { role: 'user',      content: results },
  ], context, depth + 1);
}

// ── Groq loop — plain chat, no tools (Llama tool calling is unreliable) ──
async function runGroqLoop(slug, messages, context = {}) {
  const system = loadSystemPrompt(slug);
  const groqMessages = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
  ];
  const res = await groq.chat.completions.create({
    model: MODEL_GROQ,
    messages: groqMessages,
    max_tokens: 4096,
  });
  return (res.choices[0].message.content || '').trim();
}

// ── Main dispatch — picks provider per agent ──────────────────────────────
async function dispatchAgent(slug, messages, context = {}) {
  const agent       = AGENTS[slug];
  const useAnthropic =
    PROVIDER === 'anthropic' ||
    (PROVIDER === 'auto' && agent?.opus) ||
    (!groq);

  if (useAnthropic) {
    if (!anthropic) throw new Error('Anthropic API key not configured.');
    return runAnthropicLoop(slug, messages, context);
  }

  // Use Groq, fall back to Anthropic if it fails
  try {
    return await runGroqLoop(slug, messages, context);
  } catch (err) {
    console.warn(`[${slug}] Groq failed (${err.message}) — falling back to Anthropic`);
    if (!anthropic) throw new Error('Both Groq and Anthropic unavailable.');
    return runAnthropicLoop(slug, messages, context);
  }
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

  // Commands
  if (content === '!clear') {
    histories.delete(message.channel.id);
    await message.reply('◈ Conversation cleared.');
    return;
  }
  if (content === '!status') {
    const up = Math.floor(process.uptime());
    const providerInfo = PROVIDER === 'auto'
      ? `Groq (free) for 13 agents · Anthropic (${MODEL_ANTHROPIC_OPUS}) for senior 4`
      : PROVIDER === 'groq' ? `Groq only (${MODEL_GROQ})` : `Anthropic only`;
    await message.reply(
      `**◈ Based HQ**\nUptime: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m\n` +
      `Provider: ${providerInfo}\nActive histories: ${histories.size}`
    );
    return;
  }
  if (content === '!help') {
    const list = Object.entries(AGENTS)
      .map(([s, { name, icon, opus }]) => `${icon} **#${s}** — ${name}${opus ? ' *(Anthropic)*' : ' *(Groq/free)*'}`)
      .join('\n');
    const tools = TOOL_DEFINITIONS.map(t => `\`${t.name}\``).join(' · ');
    await message.reply(`**◈ Based HQ**\n\n${list}\n\n**Tools:** ${tools}\n\n**Commands:** \`!clear\` · \`!help\` · \`!status\``);
    return;
  }

  // Route by channel name OR message prefix (e.g. "architect: ...")
  let slug, messageContent;

  const byChannel = Object.keys(AGENTS).find(s => channelName === s);
  if (byChannel) {
    slug = byChannel;
    messageContent = content;
  } else {
    // Detect prefix: "architect: ..." or "Senior Engineer: ..."
    const lower = content.toLowerCase();
    for (const [s, { name }] of Object.entries(AGENTS)) {
      if (lower.startsWith(s + ':')) {
        slug = s;
        messageContent = content.slice(s.length + 1).trim();
        break;
      }
      const lname = name.toLowerCase();
      if (lower.startsWith(lname + ':')) {
        slug = s;
        messageContent = content.slice(lname.length + 1).trim();
        break;
      }
    }
  }

  if (!slug || !messageContent) return;

  const channelId = message.channel.id;
  if (!histories.has(channelId)) histories.set(channelId, []);
  const history = histories.get(channelId);
  history.push({ role: 'user', content: messageContent });

  const typing = startTyping(message.channel);

  try {
    const reply = await dispatchAgent(slug, [...history]);
    if (!reply) { clearInterval(typing); await message.reply('No response. Try again.'); return; }

    history.push({ role: 'assistant', content: reply });
    while (history.length > 20) history.shift();

    clearInterval(typing);
    const parts = splitMessage(reply);
    await message.reply(parts[0]);
    for (const p of parts.slice(1)) await message.channel.send(p);

  } catch (err) {
    clearInterval(typing);
    console.error(`[${slug}]`, err);
    await message.reply(`◈ Error: ${(err.message || 'Something went wrong').slice(0, 200)}`);
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────
discord.once('ready', () => {
  const hasGroq      = !!groq;
  const hasAnthropic = !!anthropic;
  const providerLine = PROVIDER === 'auto'
    ? `auto  (Groq free for 13 agents · Anthropic Opus for senior 4)`
    : PROVIDER === 'groq' ? `groq  (${MODEL_GROQ})` : `anthropic (${MODEL_ANTHROPIC_OPUS} / ${MODEL_ANTHROPIC_SONNET})`;

  console.log(`\n◈ Based HQ  →  ${discord.user.tag}`);
  console.log(`  Provider : ${providerLine}`);
  console.log(`  Groq     : ${hasGroq ? '✓ configured (free)' : '✗ not configured'}`);
  console.log(`  Anthropic: ${hasAnthropic ? '✓ configured' : '✗ not configured'}`);
  console.log(`  Root     : ${PROJECT_ROOT}`);
  console.log(`\n  Type anything in an agent channel to start.\n`);
  discord.user.setActivity('Based HQ', { type: ActivityType.Watching });
});

discord.on('error', e => console.error('Discord error:', e));
process.on('unhandledRejection', e => console.error('Unhandled:', e));

discord.login(config.discord_token);
