'use strict';
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { config, PROJECT_ROOT } = require('./config');

// ── Tool definitions (Anthropic format) ──────────────────────────────────────
const DEFINITIONS = [
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
        agent:    { type: 'string', description: 'Agent slug (e.g. architect, qa, devops)' },
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
        dir:      { type: 'string', description: 'Optional subdirectory.' },
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

// ── Human-readable progress description for each tool call ───────────────────
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
      case 'web_search':          return await webSearch(input);
      case 'consult_agent':       return await consultAgent(input, context);
      case 'read_file':           return readFile(input);
      case 'write_file':          return writeFile(input);
      case 'run_command':         return runCommand(input);
      case 'search_codebase':     return searchCodebase(input);
      case 'list_files':          return listFiles(input);
      case 'get_git_info':        return getGitInfo(input);
      case 'create_github_issue': return await createGithubIssue(input);
      default:                    return `Unknown tool: ${name}`;
    }
  } catch (e) {
    return `Tool error (${name}): ${e.message}`;
  }
}

// ── Implementations ───────────────────────────────────────────────────────────
async function webSearch({ query }) {
  const key = config.exa_api_key;
  if (!key) return 'Web search not configured. Add exa_api_key to config.json';
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, numResults: 5, useAutoprompt: true, type: 'neural',
      contents: { text: { maxCharacters: 350 } },
    }),
  });
  if (!res.ok) return `Search failed: HTTP ${res.status}`;
  const data = await res.json();
  if (!data.results?.length) return 'No results.';
  return data.results
    .map(r => `**${r.title}**\n${r.url}\n${r.text?.slice(0, 300) || ''}`)
    .join('\n\n---\n\n');
}

async function consultAgent({ agent, question }, context) {
  // Lazy require to avoid circular dependency at module load time
  const { AGENTS, dispatchAgent } = require('./agents');
  if (!AGENTS[agent]) return `Unknown agent: ${agent}`;
  if (agent === context.currentAgent) return 'Cannot consult yourself.';
  if ((context.consultDepth || 0) >= 2) return 'Max consultation depth (2).';
  const reply = await dispatchAgent(agent, [{ role: 'user', content: question }], {
    ...context,
    consultDepth: (context.consultDepth || 0) + 1,
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
      cwd: PROJECT_ROOT, timeout: 30000,
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return (out || '').trim().slice(0, 3000) || '(no output)';
  } catch (err) {
    return `Exit ${err.status ?? 1}: ${((err.stdout || '') + (err.stderr || '') || err.message).trim().slice(0, 2000)}`;
  }
}

function searchCodebase({ pattern, dir, file_ext }) {
  const target = dir ? path.join(PROJECT_ROOT, dir) : PROJECT_ROOT;
  const ext = file_ext
    ? `--include="*.${file_ext}"`
    : '--include="*.ts" --include="*.tsx" --include="*.js"';
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
  const cmds = {
    status: 'git status --short',
    log:    'git log --oneline -15',
    diff:   'git diff --stat HEAD~1',
  };
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

module.exports = { DEFINITIONS, execute, describeUse };
