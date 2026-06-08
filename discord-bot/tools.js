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
      case 'send_file':           return await sendFile(input, context);
      case 'search_gif':          return await searchGif(input);
      case 'dm_hus':              return await dmHus(input, context);
      default:                    return `Unknown tool: ${name}`;
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

// ── search_gif — Tenor GIF search ────────────────────────────────────────────
async function searchGif({ query }) {
  const key = config.tenor_api_key;
  if (!key) return 'Tenor not configured (add tenor_api_key to config.json)';
  try {
    const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}&limit=8`;
    const res  = await fetch(url);
    if (!res.ok) return `Tenor error: HTTP ${res.status}`;
    const data    = await res.json();
    const results = data.results || [];
    if (!results.length) return 'No GIFs found.';
    const pick   = results[Math.floor(Math.random() * results.length)];
    const gifUrl = pick.media_formats?.gif?.url || pick.media_formats?.tinygif?.url;
    return gifUrl || 'No URL in result.';
  } catch (err) {
    return `Tenor failed: ${err.message}`;
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

module.exports = { DEFINITIONS, execute, describeUse, searchGifUrl };
