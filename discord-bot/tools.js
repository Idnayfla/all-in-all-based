'use strict';
const { execSync } = require('child_process');
const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { config, PROJECT_ROOT } = require('./config');

// ── Optional dependencies — graceful degradation if not installed ─────────────
let playwright  = null;
let nodemailer  = null;
let nodeNotifier = null;
try { playwright   = require('playwright');    } catch {}
try { nodemailer   = require('nodemailer');    } catch {}
try { nodeNotifier = require('node-notifier'); } catch {}

// ── Tool definitions ──────────────────────────────────────────────────────────
const DEFINITIONS = [
  // ── Existing ───────────────────────────────────────────────────────────────
  {
    name: 'web_search',
    description: 'Search the web for live information — docs, prices, news, anything current.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'consult_agent',
    description: 'Get a specialist opinion from another agent.',
    input_schema: {
      type: 'object',
      properties: {
        agent:    { type: 'string', description: 'Agent slug (e.g. architect, qa, devops)' },
        question: { type: 'string' },
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
        path:    { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run any shell command in the project root — git, npm, python, curl, anything. 60s timeout.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'search_codebase',
    description: 'Search for a pattern across all source files.',
    input_schema: {
      type: 'object',
      properties: {
        pattern:  { type: 'string' },
        dir:      { type: 'string' },
        file_ext: { type: 'string' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'get_git_info',
    description: 'Get git status, recent commits, or diff.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['status', 'log', 'diff'] } },
      required: ['type'],
    },
  },
  {
    name: 'create_github_issue',
    description: 'Create a GitHub issue.',
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

  // ── New: Web & Network ─────────────────────────────────────────────────────
  {
    name: 'fetch_url',
    description: 'Make any HTTP request — GET a web page, call an API, POST data, hit a webhook. Returns the response body.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'Full URL to fetch.' },
        method:  { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'], description: 'HTTP method (default GET).' },
        headers: { type: 'object', description: 'Optional request headers as key-value pairs.' },
        body:    { type: 'string', description: 'Optional request body (for POST/PUT/PATCH).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browse_web',
    description: 'Open a real browser (Playwright/Chromium) and interact with a website. Read page content, take screenshots, click buttons, fill forms. Requires playwright to be installed.',
    input_schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', description: 'URL to navigate to.' },
        action:   { type: 'string', enum: ['read','screenshot','click','fill','extract'], description: 'read=get page text, screenshot=save image, click=click selector, fill=type into selector, extract=get text from selector.' },
        selector: { type: 'string', description: 'CSS selector for click/fill/extract.' },
        text:     { type: 'string', description: 'Text to type (for fill action).' },
        wait:     { type: 'number', description: 'Extra ms to wait for page load (default 0).' },
      },
      required: ['url', 'action'],
    },
  },
  {
    name: 'download_file',
    description: 'Download a file from any URL and save it to the project directory.',
    input_schema: {
      type: 'object',
      properties: {
        url:         { type: 'string' },
        destination: { type: 'string', description: 'Save path relative to project root.' },
      },
      required: ['url', 'destination'],
    },
  },

  // ── New: Communication ─────────────────────────────────────────────────────
  {
    name: 'send_email',
    description: 'Send an email. Requires email config in config.json (email.smtp_host, email.user, email.pass).',
    input_schema: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string' },
        body:    { type: 'string', description: 'Email body (plain text or HTML).' },
        cc:      { type: 'string', description: 'Optional CC address.' },
        html:    { type: 'boolean', description: 'True if body is HTML (default false).' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'notify_desktop',
    description: 'Send an immediate desktop notification to Hus. Use for urgent alerts that need attention now.',
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string' },
        message: { type: 'string' },
        sound:   { type: 'boolean', description: 'Play alert sound (default true).' },
      },
      required: ['title', 'message'],
    },
  },

  // ── New: GitHub ────────────────────────────────────────────────────────────
  {
    name: 'create_github_pr',
    description: 'Create a GitHub pull request from the current branch. Requires gh CLI authenticated.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body:  { type: 'string' },
        base:  { type: 'string', description: 'Base branch (default: main).' },
        draft: { type: 'boolean', description: 'Create as draft PR (default false).' },
      },
      required: ['title', 'body'],
    },
  },

  // ── New: File system ───────────────────────────────────────────────────────
  {
    name: 'manage_files',
    description: 'Copy, move, delete, or create directories within the project.',
    input_schema: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['copy','move','delete','mkdir'] },
        source:      { type: 'string', description: 'Source path relative to project root.' },
        destination: { type: 'string', description: 'Destination path (required for copy and move).' },
      },
      required: ['action', 'source'],
    },
  },

  // ── New: System ───────────────────────────────────────────────────────────
  {
    name: 'get_system_info',
    description: 'Get system information — memory usage, CPU, disk space, running processes.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['memory','cpu','disk','processes','all'], description: 'What to retrieve.' },
      },
      required: ['type'],
    },
  },

  // ── New: Discord file sending ─────────────────────────────────────────────
  {
    name: 'send_file',
    description: 'Send an image, video, GIF, PDF, or any file directly into the Discord conversation — exactly like a human would. Accepts a local file path OR a public URL. Optionally include a caption.',
    input_schema: {
      type: 'object',
      properties: {
        file:    { type: 'string', description: 'Local file path (relative to project root) OR a public URL (https://...).' },
        caption: { type: 'string', description: 'Optional text message to send with the file.' },
      },
      required: ['file'],
    },
  },
  {
    name: 'search_gif',
    description: 'Search Tenor for a GIF to share in Discord. Use for celebrations, reactions, or when a GIF fits better than words. Returns a URL — pass it to send_file to post it.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for, e.g. "celebrating", "mind blown", "good job", "facepalm"' } },
      required: ['query'],
    },
  },
  {
    name: 'dm_hus',
    description: 'Send a private direct message to Hus. Use for sensitive info, a private heads-up, or anything not right for the main channel.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The private message to send.' } },
      required: ['message'],
    },
  },

  // ── Work efficiency ────────────────────────────────────────────────────────
  {
    name: 'stripe_query',
    description: 'Query Stripe for real revenue data — MRR, active subscriptions, recent charges, failed payments. Requires stripe_secret_key in config.json.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['mrr', 'subscriptions', 'charges', 'failed', 'summary'], description: 'mrr=monthly recurring revenue, subscriptions=active sub list, charges=recent payments, failed=failed charges, summary=MRR+sub count+recent.' },
        limit: { type: 'number', description: 'Number of records to return (default 10, max 100).' },
      },
      required: ['type'],
    },
  },
  {
    name: 'schedule_message',
    description: 'Schedule a Discord message to be sent at a specific future time. Use to set reminders, follow-ups, or time-based announcements. The message will appear in the current channel from you.',
    input_schema: {
      type: 'object',
      properties: {
        message:    { type: 'string', description: 'The message to send.' },
        send_at:    { type: 'string', description: 'ISO 8601 datetime when to send, e.g. "2025-06-10T09:00:00+08:00" for 9am SGT.' },
        channel:    { type: 'string', description: 'Channel name to post in (default: current channel).' },
      },
      required: ['message', 'send_at'],
    },
  },
  {
    name: 'read_discord_history',
    description: 'Read recent message history from any channel — catch up on what was discussed, get context, review decisions made while you were away.',
    input_schema: {
      type: 'object',
      properties: {
        channel_name: { type: 'string', description: 'Channel name to read from (e.g. "council", "senior-engineer").' },
        limit:        { type: 'number', description: 'Number of recent messages to fetch (default 20, max 50).' },
      },
      required: ['channel_name'],
    },
  },

  // ── Previously added ───────────────────────────────────────────────────────
  {
    name: 'github_read',
    description: 'Read GitHub issues, pull requests, PR diffs, and review status for this repo. Use to check what\'s open, review code, or see what needs attention.',
    input_schema: {
      type: 'object',
      properties: {
        type:   { type: 'string', enum: ['issues', 'prs', 'issue', 'pr_diff', 'pr_reviews'], description: 'issues=open issue list, prs=open PR list, issue=single issue detail, pr_diff=diff of a PR, pr_reviews=review status of a PR.' },
        number: { type: 'number', description: 'Issue or PR number (required for issue, pr_diff, pr_reviews).' },
        state:  { type: 'string', enum: ['open', 'closed', 'merged', 'all'], description: 'Filter by state (default: open).' },
      },
      required: ['type'],
    },
  },
  {
    name: 'agent_notes',
    description: 'Your personal persistent scratchpad. Save observations, todos, open questions, and decisions you want to remember across sessions. Separate from auto-extracted memory — this is what YOU deliberately choose to track.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'read', 'delete'], description: 'save=add/update a note, read=get all your notes, delete=remove a note.' },
        key:    { type: 'string', description: 'Short note identifier, e.g. "open-question-auth" or "todo-perf-audit" (required for save and delete).' },
        value:  { type: 'string', description: 'Content to save (required for save).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'posthog_query',
    description: 'Query PostHog analytics for Based — DAUs, top events, specific event counts. Requires posthog_api_key and posthog_project_id in config.json.',
    input_schema: {
      type: 'object',
      properties: {
        type:  { type: 'string', enum: ['dau', 'events', 'custom'], description: 'dau=daily active users trend, events=top event counts, custom=specific event over time.' },
        event: { type: 'string', description: 'Event name for custom query (e.g. "generation_started", "$pageview").' },
        days:  { type: 'number', description: 'Days to look back (default 7).' },
      },
      required: ['type'],
    },
  },
  {
    name: 'create_discord_event',
    description: 'Create a scheduled event in the Discord server — team meetings, reviews, syncs. Appears in the Events tab so everyone can see it.',
    input_schema: {
      type: 'object',
      properties: {
        name:             { type: 'string', description: 'Event name.' },
        description:      { type: 'string', description: 'What the event is about.' },
        start_time:       { type: 'string', description: 'ISO 8601 datetime, e.g. "2025-06-10T14:00:00+08:00" for 2pm SGT.' },
        duration_minutes: { type: 'number', description: 'Duration in minutes (default 60).' },
      },
      required: ['name', 'start_time'],
    },
  },
];

// ── Human-readable progress descriptions ─────────────────────────────────────
function describeUse(name, input) {
  switch (name) {
    case 'read_file':           return `Reading \`${input.path}\``;
    case 'write_file':          return `Writing \`${input.path}\``;
    case 'run_command':         return `Running \`${(input.command || '').slice(0, 60)}\``;
    case 'search_codebase':     return `Searching for \`${input.pattern}\``;
    case 'list_files':          return `Listing \`${input.path || '.'}\``;
    case 'get_git_info':        return `Checking git ${input.type}`;
    case 'web_search':          return `Searching: "${(input.query || '').slice(0, 60)}"`;
    case 'consult_agent':       return `Consulting ${input.agent}`;
    case 'create_github_issue': return `Creating issue: "${(input.title || '').slice(0, 60)}"`;
    case 'fetch_url':           return `Fetching ${(input.method || 'GET')} ${(input.url || '').slice(0, 80)}`;
    case 'browse_web':          return `Browser ${input.action} → ${(input.url || '').slice(0, 60)}`;
    case 'download_file':       return `Downloading to \`${input.destination}\``;
    case 'send_email':          return `Sending email to ${input.to}`;
    case 'notify_desktop':      return `Notifying: "${(input.title || '').slice(0, 50)}"`;
    case 'create_github_pr':    return `Creating PR: "${(input.title || '').slice(0, 60)}"`;
    case 'manage_files':        return `${input.action} \`${input.source}\``;
    case 'get_system_info':     return `System ${input.type}`;
    case 'send_file':           return `Sending file: ${(input.file || '').slice(0, 60)}`;
    case 'search_gif':          return `Searching GIF: "${(input.query || '').slice(0, 40)}"`;
    case 'dm_hus':              return `DMing Hus`;
    case 'stripe_query':        return `Stripe ${input.type}`;
    case 'schedule_message':    return `Scheduling message for ${(input.send_at||'').slice(0,16)}`;
    case 'read_discord_history':return `Reading #${input.channel_name} history (${input.limit||20} msgs)`;
    case 'github_read':         return `GitHub ${input.type}${input.number ? ` #${input.number}` : ''}`;
    case 'agent_notes':         return `Notes: ${input.action}${input.key ? ` "${input.key}"` : ''}`;
    case 'posthog_query':       return `PostHog ${input.type}${input.event ? ` (${input.event})` : ''} ${input.days||7}d`;
    case 'create_discord_event':return `Creating event: "${(input.name||'').slice(0,40)}"`;
    default:                    return `Using \`${name}\``;
  }
}

// ── Path safety ───────────────────────────────────────────────────────────────
function safePath(p) {
  const abs = path.resolve(PROJECT_ROOT, p);
  if (!abs.startsWith(path.resolve(PROJECT_ROOT)))
    throw new Error('Path outside project root.');
  return abs;
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────
async function execute(name, input, context) {
  try {
    switch (name) {
      // Existing
      case 'web_search':          return await webSearch(input);
      case 'consult_agent':       return await consultAgent(input, context);
      case 'read_file':           return readFile(input);
      case 'write_file':          return writeFile(input);
      case 'run_command':         return runCommand(input);
      case 'search_codebase':     return searchCodebase(input);
      case 'list_files':          return listFiles(input);
      case 'get_git_info':        return getGitInfo(input);
      case 'create_github_issue': return await createGithubIssue(input);
      // New
      case 'fetch_url':           return await fetchUrl(input);
      case 'browse_web':          return await browseWeb(input);
      case 'download_file':       return await downloadFile(input);
      case 'send_email':          return await sendEmail(input);
      case 'notify_desktop':      return notifyDesktop(input);
      case 'create_github_pr':    return createGithubPr(input);
      case 'manage_files':        return manageFiles(input);
      case 'get_system_info':     return getSystemInfo(input);
      case 'send_file':              return await sendFile(input, context);
      case 'search_gif':             return await searchGif(input);
      case 'dm_hus':                 return await dmHus(input, context);
      case 'stripe_query':           return await stripeQuery(input);
      case 'schedule_message':       return await scheduleMessage(input, context);
      case 'read_discord_history':   return await readDiscordHistory(input, context);
      case 'github_read':            return githubRead(input);
      case 'agent_notes':            return agentNotes(input, context);
      case 'posthog_query':          return await posthogQuery(input);
      case 'create_discord_event':   return await createDiscordEvent(input, context);
      default:                       return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Tool error (${name}): ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXISTING IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════════════

async function webSearch({ query }) {
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

async function consultAgent({ agent, question }, context) {
  const { AGENTS, dispatchAgent } = require('./agents');
  if (!AGENTS[agent]) return `Unknown agent: ${agent}`;
  if (agent === context.currentAgent) return 'Cannot consult yourself.';
  if ((context.consultDepth || 0) >= 2) return 'Max consultation depth (2).';
  const reply = await dispatchAgent(agent, [{ role: 'user', content: question }], {
    ...context, consultDepth: (context.consultDepth || 0) + 1,
  });
  const a = AGENTS[agent];
  return `${a.icon} **${a.name}:**\n${reply}`;
}

function readFile({ path: p }) {
  const abs = safePath(p);
  if (!fs.existsSync(abs)) return `Not found: ${p}`;
  const c = fs.readFileSync(abs, 'utf-8');
  return c.length > 10000 ? c.slice(0, 10000) + '\n[truncated]' : c;
}

function writeFile({ path: p, content }) {
  const abs = safePath(p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return `Written ${content.length} chars to ${p}`;
}

function runCommand({ command }) {
  try {
    const out = execSync(command, {
      cwd: PROJECT_ROOT, timeout: 60000,
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return (out || '').trim().slice(0, 3000) || '(no output)';
  } catch (err) {
    return `Exit ${err.status ?? 1}: ${((err.stdout || '') + (err.stderr || '') || err.message).trim().slice(0, 2000)}`;
  }
}

function searchCodebase({ pattern, dir, file_ext }) {
  const target = dir ? path.join(PROJECT_ROOT, dir) : PROJECT_ROOT;
  const ext = file_ext ? `--include="*.${file_ext}"` : '--include="*.ts" --include="*.tsx" --include="*.js"';
  try {
    return execSync(
      `grep -rn "${pattern.replace(/"/g, '\\"')}" "${target}" ${ext} --max-count=3 2>/dev/null | head -40`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim() || 'No matches.';
  } catch { return 'No matches.'; }
}

function listFiles({ path: p }) {
  const abs = safePath(p || '.');
  if (!fs.existsSync(abs)) return `Not found: ${p}`;
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter(i => i.name !== 'node_modules')
    .map(i => `${i.isDirectory() ? '[dir]' : '[file]'} ${i.name}`)
    .join('\n') || '(empty)';
}

function getGitInfo({ type }) {
  const cmds = { status: 'git status --short', log: 'git log --oneline -15', diff: 'git diff --stat HEAD~1' };
  try {
    return execSync(cmds[type] || 'git status', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim() || '(clean)';
  } catch (e) { return `git error: ${e.message}`; }
}

async function createGithubIssue({ title, body, labels = [] }) {
  const lf = labels.length ? `--label "${labels.join(',')}"` : '';
  try {
    const out = execSync(
      `gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" ${lf}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    return `Created: ${out.trim()}`;
  } catch (e) { return `Failed: ${(e.stderr || e.message || '').slice(0, 400)}`; }
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════════════

// ── fetch_url — HTTP requests to anything ────────────────────────────────────
async function fetchUrl({ url, method = 'GET', headers = {}, body }) {
  const opts = {
    method,
    headers: { 'User-Agent': 'Based-HQ-Agent/1.0', ...headers },
  };
  if (body) {
    opts.body = body;
    if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
  }

  const res  = await fetch(url, opts);
  const text = await res.text();

  // Pretty-print JSON if possible
  let out = text;
  try { out = JSON.stringify(JSON.parse(text), null, 2); } catch {}

  return `HTTP ${res.status} ${res.statusText}\n\n${out.slice(0, 4000)}`;
}

// ── browse_web — Full browser automation ─────────────────────────────────────
async function browseWeb({ url, action, selector, text, wait = 0 }) {
  if (!playwright) {
    return [
      'Playwright is not installed. To enable browser tools, run:',
      '  cd discord-bot && npm install playwright',
      '  npx playwright install chromium',
    ].join('\n');
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page    = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (wait > 0) await page.waitForTimeout(wait);

    switch (action) {
      case 'read': {
        const content = await page.evaluate(() => {
          // Remove scripts, styles, navs for cleaner output
          document.querySelectorAll('script,style,nav,header,footer').forEach(el => el.remove());
          return document.body?.innerText || '';
        });
        return content.trim().slice(0, 6000);
      }

      case 'screenshot': {
        const file = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
        await page.screenshot({ path: file, fullPage: false });
        return `Screenshot saved: ${file}\nDimensions: ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`;
      }

      case 'click': {
        if (!selector) return 'selector required for click action';
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.click(selector);
        await page.waitForTimeout(1000);
        const content = await page.evaluate(() => document.body?.innerText || '');
        return `Clicked "${selector}". Page now shows:\n${content.trim().slice(0, 3000)}`;
      }

      case 'fill': {
        if (!selector) return 'selector required for fill action';
        if (text === undefined) return 'text required for fill action';
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.fill(selector, text);
        return `Filled "${selector}" with: ${text.slice(0, 100)}`;
      }

      case 'extract': {
        if (!selector) return 'selector required for extract action';
        await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
        const extracted = await page.$$eval(selector, els => els.map(e => e.innerText).join('\n'));
        return extracted.trim().slice(0, 5000) || `No elements matched "${selector}"`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  } finally {
    await browser.close();
  }
}

// ── download_file ─────────────────────────────────────────────────────────────
async function downloadFile({ url, destination }) {
  const dest = safePath(destination);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const res = await fetch(url);
  if (!res.ok) return `Download failed: HTTP ${res.status}`;

  const buf = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buf));
  return `Downloaded ${url} → ${destination} (${(buf.byteLength / 1024).toFixed(1)} KB)`;
}

// ── send_email ────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, body, cc, html = false }) {
  if (!nodemailer) {
    return 'nodemailer not installed. Run: cd discord-bot && npm install nodemailer';
  }

  const emailCfg = config.email;
  if (!emailCfg?.smtp_host || !emailCfg?.user || !emailCfg?.pass) {
    return [
      'Email not configured. Add to config.json:',
      '  "email": {',
      '    "smtp_host": "smtp.gmail.com",',
      '    "smtp_port": 587,',
      '    "user": "you@gmail.com",',
      '    "pass": "your-app-password"',
      '  }',
      'For Gmail: enable 2FA → Google Account → Security → App Passwords',
    ].join('\n');
  }

  const transporter = nodemailer.createTransport({
    host: emailCfg.smtp_host,
    port: emailCfg.smtp_port || 587,
    secure: (emailCfg.smtp_port || 587) === 465,
    auth: { user: emailCfg.user, pass: emailCfg.pass },
  });

  const mail = { from: emailCfg.user, to, subject };
  if (cc) mail.cc = cc;
  if (html) mail.html = body; else mail.text = body;

  const info = await transporter.sendMail(mail);
  return `Email sent to ${to} (${info.messageId})`;
}

// ── notify_desktop ────────────────────────────────────────────────────────────
function notifyDesktop({ title, message, sound = true }) {
  if (nodeNotifier) {
    nodeNotifier.notify({ title, message, sound });
    return `Notification sent: ${title}`;
  }

  // Fallback: PowerShell toast on Windows
  try {
    const t = title.replace(/'/g, '');
    const m = message.replace(/'/g, '');
    execSync(
      `powershell -Command "` +
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
      `$n.Icon = [System.Drawing.SystemIcons]::Information; ` +
      `$n.Visible = $true; ` +
      `$n.ShowBalloonTip(5000, '${t}', '${m}', 'Info'); ` +
      `Start-Sleep 1; $n.Dispose()"`,
      { timeout: 8000 }
    );
    return `Desktop notification sent: ${title}`;
  } catch {
    // Final fallback: just log it
    console.log(`\n[ALERT] ${title}: ${message}\n`);
    return `Alert logged (install node-notifier for popup): ${title}`;
  }
}

// ── create_github_pr ──────────────────────────────────────────────────────────
function createGithubPr({ title, body, base = 'main', draft = false }) {
  const draftFlag = draft ? '--draft' : '';
  try {
    // Push current branch first if needed
    const branch = execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
    try { execSync(`git push -u origin ${branch}`, { cwd: PROJECT_ROOT, encoding: 'utf-8' }); } catch {}

    const out = execSync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${base} ${draftFlag}`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30000 }
    );
    return `PR created: ${out.trim()}`;
  } catch (e) {
    return `PR creation failed: ${(e.stderr || e.message || '').slice(0, 400)}`;
  }
}

// ── manage_files ──────────────────────────────────────────────────────────────
function manageFiles({ action, source, destination }) {
  const srcAbs = safePath(source);

  switch (action) {
    case 'copy': {
      if (!destination) return 'destination required for copy';
      const destAbs = safePath(destination);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      return `Copied ${source} → ${destination}`;
    }
    case 'move': {
      if (!destination) return 'destination required for move';
      const destAbs = safePath(destination);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.renameSync(srcAbs, destAbs);
      return `Moved ${source} → ${destination}`;
    }
    case 'delete': {
      if (!fs.existsSync(srcAbs)) return `Not found: ${source}`;
      const stat = fs.statSync(srcAbs);
      if (stat.isDirectory()) {
        fs.rmSync(srcAbs, { recursive: true, force: true });
      } else {
        fs.unlinkSync(srcAbs);
      }
      return `Deleted ${source}`;
    }
    case 'mkdir': {
      fs.mkdirSync(srcAbs, { recursive: true });
      return `Directory created: ${source}`;
    }
    default:
      return `Unknown action: ${action}`;
  }
}

// ── get_system_info ───────────────────────────────────────────────────────────
function getSystemInfo({ type }) {
  switch (type) {
    case 'memory': {
      const total = os.totalmem();
      const free  = os.freemem();
      const used  = total - free;
      return `Memory: ${(used/1e9).toFixed(2)}GB used / ${(total/1e9).toFixed(2)}GB total (${Math.round(used/total*100)}% used)`;
    }
    case 'cpu': {
      const cpus = os.cpus();
      return `CPU: ${cpus[0].model}\nCores: ${cpus.length}\nLoad avg: ${os.loadavg().map(n => n.toFixed(2)).join(', ')}`;
    }
    case 'disk': {
      try {
        // Windows
        const out = execSync('wmic logicaldisk get Caption,Size,FreeSpace /format:csv', { encoding: 'utf-8', timeout: 5000 });
        return out.trim().slice(0, 1000);
      } catch {
        try {
          return execSync('df -h /', { encoding: 'utf-8', timeout: 5000 }).trim();
        } catch (e) { return `Disk info unavailable: ${e.message}`; }
      }
    }
    case 'processes': {
      try {
        // Top 20 processes by memory
        const out = execSync('tasklist /fo csv /nh', { encoding: 'utf-8', timeout: 8000 });
        const lines = out.trim().split('\n').slice(0, 20);
        return lines.join('\n');
      } catch (e) { return `Process list unavailable: ${e.message}`; }
    }
    case 'all': {
      const total = os.totalmem();
      const free  = os.freemem();
      const used  = total - free;
      return [
        `OS      : ${os.type()} ${os.release()} (${os.arch()})`,
        `Host    : ${os.hostname()}`,
        `CPU     : ${os.cpus()[0].model} x${os.cpus().length} cores`,
        `Memory  : ${(used/1e9).toFixed(2)}GB / ${(total/1e9).toFixed(2)}GB (${Math.round(used/total*100)}%)`,
        `Uptime  : ${Math.floor(os.uptime()/3600)}h ${Math.floor((os.uptime()%3600)/60)}m`,
        `Platform: ${os.platform()}`,
      ].join('\n');
    }
    default:
      return `Unknown type: ${type}`;
  }
}

// ── send_file — attach image/video/doc directly into Discord ─────────────────
async function sendFile({ file, caption = '' }, context) {
  const channel = context?.channel;
  if (!channel) {
    return 'No Discord channel in context — send_file only works during live conversations.';
  }

  const { sendAsAgentWithFiles } = require('./messenger');
  const slug = context.currentAgent || 'orchestrator';

  // Resolve file: URL passes through, local path gets resolved safely
  let attachment;
  if (file.startsWith('http://') || file.startsWith('https://')) {
    attachment = file;
  } else {
    const abs = safePath(file);
    if (!fs.existsSync(abs)) return `File not found: ${file}`;
    attachment = abs;
  }

  await sendAsAgentWithFiles(channel, slug, caption, [attachment]);
  return `File sent: ${path.basename(file)}${caption ? ` with caption "${caption.slice(0,60)}"` : ''}`;
}

// ── search_gif — Giphy search ─────────────────────────────────────────────────
async function searchGif({ query }) {
  const key = config.giphy_api_key;
  if (!key) return 'Giphy not configured (get a free key at developers.giphy.com, add giphy_api_key to config.json)';
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=25&rating=g`;
    const res  = await fetch(url);
    if (!res.ok) return `Giphy error: HTTP ${res.status}`;
    const data    = await res.json();
    const results = data.data || [];
    if (!results.length) return 'No GIFs found.';
    const pick   = results[Math.floor(Math.random() * results.length)];
    return pick.images?.original?.url || pick.images?.downsized?.url || 'No URL in result.';
  } catch (err) {
    return `Giphy failed: ${err.message}`;
  }
}

// Direct call variant — returns URL or null (for use in council.js without tool framework)
async function searchGifUrl(query) {
  const result = await searchGif({ query }).catch(() => null);
  return (result && result.startsWith('http')) ? result : null;
}

// ── dm_hus — DM the founder directly ─────────────────────────────────────────
async function dmHus({ message }, context) {
  const discord = context?.discordClient;
  if (!discord) return 'No Discord client in context.';
  const userId = config.authorized_user_id;
  if (!userId) return 'No authorized_user_id in config.';
  try {
    const user = await discord.users.fetch(userId);
    const dm   = await user.createDM();
    await dm.send(message);
    return 'DM sent to Hus.';
  } catch (err) {
    return `DM failed: ${err.message}`;
  }
}

// ── stripe_query — pull real revenue data from Stripe API ────────────────────
async function stripeQuery({ type, limit = 10 }) {
  const key = config.stripe_secret_key;
  if (!key) return 'Stripe not configured. Add stripe_secret_key to config.json (get from dashboard.stripe.com → Developers → API keys).';
  const cap = Math.min(limit, 100);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const get = async (path) => {
    const res = await fetch(`https://api.stripe.com/v1${path}`, { headers });
    if (!res.ok) throw new Error(`Stripe HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  };

  try {
    switch (type) {
      case 'mrr': {
        const subs = await get(`/subscriptions?status=active&limit=100`);
        const mrr  = (subs.data || []).reduce((sum, s) => {
          const item = s.items?.data?.[0];
          if (!item) return sum;
          const amt = item.price?.unit_amount || 0;
          const int = item.price?.recurring?.interval;
          const monthly = int === 'year' ? amt / 12 : int === 'week' ? amt * 4 : amt;
          return sum + monthly / 100;
        }, 0);
        return `MRR: $${mrr.toFixed(2)} USD\nActive subscriptions: ${subs.data?.length || 0}${subs.has_more ? '+' : ''}`;
      }
      case 'subscriptions': {
        const subs = await get(`/subscriptions?status=active&limit=${cap}&expand[]=data.customer`);
        const rows = (subs.data || []).map(s => {
          const email = s.customer?.email || s.customer || 'unknown';
          const plan  = s.items?.data?.[0]?.price?.nickname || s.items?.data?.[0]?.price?.id || 'plan';
          const amt   = ((s.items?.data?.[0]?.price?.unit_amount || 0) / 100).toFixed(2);
          return `  ${email} — $${amt}/${s.items?.data?.[0]?.price?.recurring?.interval || '?'} (${plan})`;
        });
        return `Active subscriptions (${rows.length}):\n${rows.join('\n')}`;
      }
      case 'charges': {
        const charges = await get(`/charges?limit=${cap}`);
        const rows    = (charges.data || []).map(c => {
          const date = new Date(c.created * 1000).toISOString().slice(0, 10);
          const amt  = (c.amount / 100).toFixed(2);
          return `  ${date}  $${amt} ${c.currency.toUpperCase()}  ${c.billing_details?.email || c.customer || ''}  ${c.status}`;
        });
        return `Recent charges (${rows.length}):\n${rows.join('\n')}`;
      }
      case 'failed': {
        const charges = await get(`/charges?limit=${cap}&status=failed`);
        const rows    = (charges.data || []).map(c => {
          const date = new Date(c.created * 1000).toISOString().slice(0, 10);
          const amt  = (c.amount / 100).toFixed(2);
          return `  ${date}  $${amt}  ${c.billing_details?.email || ''}  reason: ${c.failure_message || c.failure_code || 'unknown'}`;
        });
        return rows.length ? `Failed charges (${rows.length}):\n${rows.join('\n')}` : 'No failed charges found.';
      }
      case 'summary': {
        const [subs, charges, bal] = await Promise.all([
          get('/subscriptions?status=active&limit=100'),
          get('/charges?limit=10'),
          get('/balance'),
        ]);
        const mrr = (subs.data || []).reduce((sum, s) => {
          const item = s.items?.data?.[0];
          if (!item) return sum;
          const amt = item.price?.unit_amount || 0;
          const int = item.price?.recurring?.interval;
          return sum + (int === 'year' ? amt / 12 : int === 'week' ? amt * 4 : amt) / 100;
        }, 0);
        const avail = ((bal.available?.[0]?.amount || 0) / 100).toFixed(2);
        const recent = (charges.data || []).slice(0, 5).map(c =>
          `  ${new Date(c.created*1000).toISOString().slice(0,10)}  $${(c.amount/100).toFixed(2)}  ${c.status}`
        ).join('\n');
        return `**Stripe Summary**\nMRR: $${mrr.toFixed(2)}\nActive subs: ${subs.data?.length || 0}\nBalance available: $${avail}\n\nLast 5 charges:\n${recent}`;
      }
      default:
        return 'Unknown type. Use: mrr, subscriptions, charges, failed, summary';
    }
  } catch (err) {
    return `Stripe query failed: ${err.message}`;
  }
}

// ── schedule_message — fire a Discord message at a future datetime ────────────
const SCHEDULED_FILE = path.join(__dirname, 'scheduled-messages.json');

async function scheduleMessage({ message, send_at, channel: channelName }, context) {
  const fireAt = new Date(send_at);
  if (isNaN(fireAt.getTime())) return `Invalid send_at: "${send_at}". Use ISO 8601 format.`;
  if (fireAt <= new Date()) return 'send_at must be in the future.';

  let scheduled = [];
  try { scheduled = JSON.parse(fs.readFileSync(SCHEDULED_FILE, 'utf-8')); } catch {}

  const entry = {
    id:          `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    slug:        context?.currentAgent || 'orchestrator',
    channelId:   channelName ? null : context?.channel?.id,
    channelName: channelName || context?.channel?.name || null,
    message,
    fireAt:      fireAt.toISOString(),
    created:     new Date().toISOString(),
  };

  scheduled.push(entry);
  fs.writeFileSync(SCHEDULED_FILE, JSON.stringify(scheduled, null, 2));

  const sgt = fireAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
  return `Scheduled: "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}" → ${sgt} SGT`;
}

// ── read_discord_history — fetch recent messages from any channel ─────────────
async function readDiscordHistory({ channel_name, limit = 20 }, context) {
  const discord = context?.discordClient;
  if (!discord) return 'No Discord client in context — works only during live conversations.';
  const guild = discord.guilds.cache.first();
  if (!guild)   return 'No guild found.';

  const ch = guild.channels.cache.find(c =>
    c.name?.toLowerCase() === channel_name.toLowerCase() && c.isTextBased?.()
  );
  if (!ch) return `Channel #${channel_name} not found. Available: ${guild.channels.cache.filter(c => c.isTextBased?.()).map(c => c.name).join(', ')}`;

  try {
    const msgs   = await ch.messages.fetch({ limit: Math.min(limit, 50) });
    const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    if (!sorted.length) return `#${channel_name} has no recent messages.`;

    return sorted.map(m => {
      const time = m.createdAt.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });
      const name = m.author.username || m.author.tag;
      const text = m.content?.slice(0, 300) || (m.attachments.size ? '[attachment]' : '[embed]');
      return `[${time}] ${name}: ${text}`;
    }).join('\n');
  } catch (err) {
    return `Failed to read history: ${err.message}`;
  }
}

// ── github_read — read issues, PRs, diffs via gh CLI ─────────────────────────
function githubRead({ type, number, state = 'open' }) {
  try {
    switch (type) {
      case 'issues':
        return execSync(
          `gh issue list --state ${state} --limit 20 --json number,title,labels,state,createdAt,assignees`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 20000 }
        ).trim();
      case 'prs':
        return execSync(
          `gh pr list --state ${state} --limit 15 --json number,title,author,reviewDecision,isDraft,createdAt,headRefName`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 20000 }
        ).trim();
      case 'issue':
        if (!number) return 'number required for issue';
        return execSync(
          `gh issue view ${number} --json title,body,state,labels,assignees,comments`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 20000 }
        ).trim().slice(0, 6000);
      case 'pr_diff':
        if (!number) return 'number required for pr_diff';
        return execSync(`gh pr diff ${number}`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 20000 }
        ).trim().slice(0, 6000);
      case 'pr_reviews':
        if (!number) return 'number required for pr_reviews';
        return execSync(
          `gh pr view ${number} --json title,state,reviews,comments,reviewRequests,statusCheckRollup`,
          { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 20000 }
        ).trim();
      default:
        return 'Unknown type. Use: issues, prs, issue, pr_diff, pr_reviews';
    }
  } catch (e) {
    return `GitHub read failed: ${(e.stderr || e.message || '').slice(0, 400)}`;
  }
}

// ── agent_notes — persistent scratchpad per agent ────────────────────────────
function agentNotes({ action, key, value }, context) {
  const slug = context?.currentAgent || 'shared';
  const dir  = path.join(__dirname, 'notes');
  const file = path.join(dir, `${slug}.json`);
  fs.mkdirSync(dir, { recursive: true });
  let notes = {};
  try { notes = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}

  switch (action) {
    case 'save': {
      if (!key)   return 'key required for save';
      if (!value) return 'value required for save';
      notes[key] = { value, at: new Date().toISOString().slice(0, 10) };
      fs.writeFileSync(file, JSON.stringify(notes, null, 2));
      return `Note saved: "${key}"`;
    }
    case 'read': {
      const entries = Object.entries(notes);
      if (!entries.length) return 'No notes yet.';
      return entries.map(([k, v]) => `**${k}** (${v.at}): ${v.value}`).join('\n');
    }
    case 'delete': {
      if (!key) return 'key required for delete';
      if (!notes[key]) return `Note "${key}" not found.`;
      delete notes[key];
      fs.writeFileSync(file, JSON.stringify(notes, null, 2));
      return `Deleted: "${key}"`;
    }
    default:
      return 'Unknown action. Use: save, read, delete';
  }
}

// ── posthog_query — pull real analytics from PostHog ─────────────────────────
async function posthogQuery({ type, event, days = 7 }) {
  const key       = config.posthog_api_key;
  const projectId = config.posthog_project_id;
  if (!key)       return 'PostHog not configured. Add posthog_api_key to config.json (get from posthog.com → Settings → Personal API keys).';
  if (!projectId) return 'PostHog not configured. Add posthog_project_id to config.json (visible in your PostHog project URL).';
  const base    = (config.posthog_host || 'https://app.posthog.com').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  try {
    switch (type) {
      case 'dau': {
        const url = `${base}/api/projects/${projectId}/insights/trend/?date_from=-${days}d&interval=day&events=[{"id":"$pageview","type":"events"}]`;
        const res  = await fetch(url, { headers });
        if (!res.ok) return `PostHog error: HTTP ${res.status}`;
        const data   = await res.json();
        const series = data.result?.[0];
        if (!series) return 'No DAU data returned.';
        const rows = (series.data || []).map((v, i) => `  ${series.labels?.[i] || i}: ${v}`).join('\n');
        const peak = Math.max(...(series.data || [0]));
        return `DAU last ${days}d (pageviews):\n${rows}\n\nPeak: ${peak}`;
      }
      case 'events': {
        const url = `${base}/api/projects/${projectId}/events/?limit=200&after=${new Date(Date.now() - days * 86400000).toISOString()}`;
        const res  = await fetch(url, { headers });
        if (!res.ok) return `PostHog error: HTTP ${res.status}`;
        const data   = await res.json();
        const counts = {};
        for (const ev of (data.results || [])) counts[ev.event] = (counts[ev.event] || 0) + 1;
        const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 20);
        return `Top events last ${days}d:\n${sorted.map(([k, v]) => `  ${v}x  ${k}`).join('\n')}`;
      }
      case 'custom': {
        if (!event) return 'event name required for custom query';
        const evEncoded = encodeURIComponent(JSON.stringify([{ id: event, type: 'events' }]));
        const url = `${base}/api/projects/${projectId}/insights/trend/?date_from=-${days}d&interval=day&events=${evEncoded}`;
        const res  = await fetch(url, { headers });
        if (!res.ok) return `PostHog error: HTTP ${res.status}`;
        const data   = await res.json();
        const series = data.result?.[0];
        if (!series) return `No data for "${event}".`;
        const total = (series.data || []).reduce((a, b) => a + b, 0);
        const rows  = (series.data || []).map((v, i) => `  ${series.labels?.[i] || i}: ${v}`).join('\n');
        return `"${event}" last ${days}d — Total: ${total}\n${rows}`;
      }
      default:
        return 'Unknown type. Use: dau, events, custom';
    }
  } catch (err) {
    return `PostHog query failed: ${err.message}`;
  }
}

// ── create_discord_event — schedule a meeting in the server's Events tab ─────
async function createDiscordEvent({ name, description = '', start_time, duration_minutes = 60 }, context) {
  const discord = context?.discordClient;
  if (!discord) return 'No Discord client in context — works only during live conversations.';
  const guild = discord.guilds.cache.first();
  if (!guild)   return 'No guild found.';

  try {
    const start = new Date(start_time);
    if (isNaN(start.getTime())) return `Invalid start_time: "${start_time}". Use ISO 8601 format, e.g. "2025-06-15T14:00:00+08:00".`;
    const end = new Date(start.getTime() + duration_minutes * 60000);

    const ev = await guild.scheduledEvents.create({
      name:                name.slice(0, 100),
      description:         description.slice(0, 1000),
      scheduledStartTime:  start,
      scheduledEndTime:    end,
      privacyLevel:        2,  // GuildOnly
      entityType:          3,  // External
      entityMetadata:      { location: 'Based HQ' },
    });

    const sgt = start.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
    return `Event created: "${name}" — ${sgt} SGT (${duration_minutes}min) · ID: ${ev.id}`;
  } catch (err) {
    return `Failed to create event: ${err.message}`;
  }
}

module.exports = { DEFINITIONS, execute, describeUse, searchGifUrl };
