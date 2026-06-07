'use strict';
/**
 * Based HQ Bot — test suite (pure logic, no Discord/API connections)
 * Run: node test.js
 */

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${label}\n        ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ── Module loading ────────────────────────────────────────────────────────────
console.log('\n── Module loading ───────────────────────────────────────────────');

test('config.js loads', () => {
  const c = require('./config');
  assert(c.PROJECT_ROOT, 'PROJECT_ROOT missing');
  assert(c.COUNCIL_CHANNEL, 'COUNCIL_CHANNEL missing');
  assert(typeof c.STANDUP_HOUR_UTC === 'number', 'STANDUP_HOUR_UTC must be number');
});

test('agents.js loads', () => {
  const a = require('./agents');
  assert(a.AGENTS, 'AGENTS missing');
  assert(typeof a.dispatchAgent === 'function', 'dispatchAgent missing');
  assert(typeof a.loadSystemPrompt === 'function', 'loadSystemPrompt missing');
});

test('tools.js loads', () => {
  const t = require('./tools');
  assert(Array.isArray(t.DEFINITIONS), 'DEFINITIONS must be array');
  assert(t.DEFINITIONS.length >= 9, 'Expected at least 9 tools');
  assert(typeof t.execute === 'function', 'execute missing');
  assert(typeof t.describeUse === 'function', 'describeUse missing');
});

test('council.js loads and exports helpers', () => {
  const c = require('./council');
  assert(typeof c.runCouncil === 'function', 'runCouncil missing');
  assert(typeof c.sanitize === 'function', 'sanitize not exported');
  assert(typeof c.isPureGreeting === 'function', 'isPureGreeting not exported');
  assert(typeof c.isGroupGreeting === 'function', 'isGroupGreeting not exported');
});

test('clients.js loads', () => {
  const c = require('./clients');
  assert(typeof c.initAgentClients === 'function', 'initAgentClients missing');
  assert(typeof c.getAgentClient === 'function', 'getAgentClient missing');
});

test('messenger.js loads', () => {
  const m = require('./messenger');
  assert(typeof m.sendAsAgent === 'function', 'sendAsAgent missing');
  assert(typeof m.sendAsOrchestrator === 'function', 'sendAsOrchestrator missing');
  assert(typeof m.splitMessage === 'function', 'splitMessage missing');
});

test('scheduler.js loads', () => {
  const s = require('./scheduler');
  assert(typeof s.init === 'function', 'init missing');
  assert(typeof s.teamAlert === 'function', 'teamAlert missing');
});

// ── Agent registry ────────────────────────────────────────────────────────────
console.log('\n── Agent registry ───────────────────────────────────────────────');

const EXPECTED_SLUGS = [
  'orchestrator','architect','senior-engineer','ai-engineer','product',
  'designer','devops','security','qa','growth','data-analyst','mobile',
  'finance','legal','community','chief-of-staff','technical-writer',
];

test('all 17 agents registered', () => {
  assertEqual(Object.keys(require('./agents').AGENTS).length, 17);
});

test('all agents have required fields', () => {
  for (const [slug, a] of Object.entries(require('./agents').AGENTS)) {
    assert(a.name,     `${slug}: missing name`);
    assert(a.icon,     `${slug}: missing icon`);
    assert(typeof a.opus === 'boolean', `${slug}: opus must be boolean`);
    assert(a.avatarURL,`${slug}: missing avatarURL`);
  }
});

test('exactly 4 Opus agents', () => {
  const opus = Object.values(require('./agents').AGENTS).filter(a => a.opus);
  assertEqual(opus.length, 4);
});

test('all expected slugs present', () => {
  const { AGENTS } = require('./agents');
  for (const slug of EXPECTED_SLUGS) assert(AGENTS[slug], `Missing agent: ${slug}`);
});

// ── isPureGreeting ────────────────────────────────────────────────────────────
console.log('\n── isPureGreeting ───────────────────────────────────────────────');

const { isPureGreeting, isGroupGreeting, sanitize } = require('./council');

test('hey',          () => assert(isPureGreeting('hey')));
test('Hey!',         () => assert(isPureGreeting('Hey!')));
test('heyy',         () => assert(isPureGreeting('heyy')));
test('hi',           () => assert(isPureGreeting('hi')));
test('hello',        () => assert(isPureGreeting('hello')));
test('lol',          () => assert(isPureGreeting('lol')));
test('morning',      () => assert(isPureGreeting('morning')));
test('hey team',     () => assert(isPureGreeting('hey team')));
test('hey everyone', () => assert(isPureGreeting('hey everyone')));
test('heyy everyone',() => assert(isPureGreeting('heyy everyone')));

test('NOT: what about the rest', () => assert(!isPureGreeting('what about the rest')));
test('NOT: fix the drum bug',    () => assert(!isPureGreeting('fix the drum bug')));
test('NOT: what is the current state of the discord bot work?',
  () => assert(!isPureGreeting('what is the current state of the discord bot work?')));
test('NOT: are you all there',   () => assert(!isPureGreeting('are you all there')));
test('NOT: other workers',       () => assert(!isPureGreeting('other workers')));

// ── isGroupGreeting ───────────────────────────────────────────────────────────
console.log('\n── isGroupGreeting ──────────────────────────────────────────────');

test('hey everyone',     () => assert(isGroupGreeting('hey everyone')));
test('heyy everyone',    () => assert(isGroupGreeting('heyy everyone')));
test('hi team',          () => assert(isGroupGreeting('hi team')));
test('morning everyone', () => assert(isGroupGreeting('morning everyone')));
test('hello folks',      () => assert(isGroupGreeting('hello folks')));
test('yo guys',          () => assert(isGroupGreeting('yo guys')));

test('NOT: what is the state of all features',
  () => assert(!isGroupGreeting('what is the state of all features')));
test('NOT: fix the drum bug',  () => assert(!isGroupGreeting('fix the drum bug')));
test('NOT: what about the rest',() => assert(!isGroupGreeting('what about the rest')));
test('NOT: are you all here',  () => assert(!isGroupGreeting('are you all here')));
test('NOT: how is it all going',() => assert(!isGroupGreeting('how is it all going')));

// ── sanitize ──────────────────────────────────────────────────────────────────
console.log('\n── sanitize ─────────────────────────────────────────────────────');

test('clean text passes through', () => {
  assertEqual(sanitize('hello world'), 'hello world');
});

test('null/undefined returns empty string', () => {
  assertEqual(sanitize(null), '');
  assertEqual(sanitize(undefined), '');
  assertEqual(sanitize(''), '');
});

test('strips <invoke> blocks', () => {
  const xml = '<invoke name="read_file"><parameter name="path">app/page.tsx</parameter></invoke>';
  const out = sanitize('Before. ' + xml + ' After.');
  assert(!out.includes('<invoke'), 'invoke tag should be stripped');
  assert(out.includes('Before.'), 'text before should remain');
  assert(out.includes('After.'), 'text after should remain');
});

test('strips <parameter> tags', () => {
  const out = sanitize('Check this: <parameter name="x">value</parameter> done.');
  assert(!out.includes('<parameter'), 'parameter tags should be stripped');
  assert(out.includes('done.'), 'surrounding text stays');
});

test('does not strip normal markdown', () => {
  const md = '**bold** and `code` and [link](url)';
  assertEqual(sanitize(md), md);
});

test('collapses triple newlines to double', () => {
  const out = sanitize('line1\n\n\n\nline2');
  assert(!out.includes('\n\n\n'), 'triple newlines should collapse');
  assert(out.includes('line1'), 'text preserved');
  assert(out.includes('line2'), 'text preserved');
});

// ── splitMessage ──────────────────────────────────────────────────────────────
console.log('\n── splitMessage ─────────────────────────────────────────────────');

const { splitMessage } = require('./messenger');

test('short text returns 1 part', () => {
  const parts = splitMessage('hello world');
  assertEqual(parts.length, 1);
  assertEqual(parts[0], 'hello world');
});

test('empty string returns 1 part', () => {
  const parts = splitMessage('');
  assertEqual(parts.length, 1);
});

test('long text splits correctly', () => {
  const long = 'x\n'.repeat(1000); // ~2000 chars
  const parts = splitMessage(long);
  assert(parts.length > 1, 'should split long text');
  for (const p of parts) assert(p.length <= 1900, `part too long: ${p.length}`);
});

test('split parts rejoin to original content', () => {
  const long = Array.from({length: 200}, (_, i) => `Line ${i}: some content here`).join('\n');
  const parts = splitMessage(long);
  const rejoined = parts.join('\n').replace(/\n+/g, '\n');
  const original = long.replace(/\n+/g, '\n');
  assertEqual(rejoined.trim(), original.trim());
});

// ── Tool definitions ──────────────────────────────────────────────────────────
console.log('\n── Tool definitions ─────────────────────────────────────────────');

const { DEFINITIONS, describeUse } = require('./tools');

test('all tools have name, description, input_schema', () => {
  for (const t of DEFINITIONS) {
    assert(t.name, `tool missing name`);
    assert(t.description, `${t.name}: missing description`);
    assert(t.input_schema, `${t.name}: missing input_schema`);
    assert(t.input_schema.required, `${t.name}: input_schema missing required`);
  }
});

test('describeUse returns string for all known tools', () => {
  const cases = [
    ['read_file',           { path: 'app/page.tsx' }],
    ['write_file',          { path: 'out.txt', content: 'x' }],
    ['run_command',         { command: 'git status' }],
    ['search_codebase',     { pattern: 'useEffect' }],
    ['list_files',          { path: 'app' }],
    ['get_git_info',        { type: 'log' }],
    ['web_search',          { query: 'Next.js 15' }],
    ['consult_agent',       { agent: 'qa', question: 'is this safe?' }],
    ['create_github_issue', { title: 'Bug', body: 'details' }],
  ];
  for (const [name, input] of cases) {
    const result = describeUse(name, input);
    assert(typeof result === 'string' && result.length > 0, `describeUse('${name}') returned empty`);
  }
});

// ── Config fields ─────────────────────────────────────────────────────────────
console.log('\n── Config validation ────────────────────────────────────────────');

test('COUNCIL_CHANNEL is a string', () => {
  assertEqual(typeof require('./config').COUNCIL_CHANNEL, 'string');
});

test('STANDUP_HOUR_UTC is 0–23', () => {
  const h = require('./config').STANDUP_HOUR_UTC;
  assert(h >= 0 && h <= 23, `STANDUP_HOUR_UTC out of range: ${h}`);
});

test('MODEL_OPUS and MODEL_SONNET defined', () => {
  const { MODEL_OPUS, MODEL_SONNET } = require('./config');
  assert(MODEL_OPUS.includes('claude'),  'MODEL_OPUS should contain "claude"');
  assert(MODEL_SONNET.includes('claude'),'MODEL_SONNET should contain "claude"');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(53)}`);
console.log(`  ${passed} passed   ${failed} failed   ${passed + failed} total`);
console.log(`${'─'.repeat(53)}\n`);

if (failed > 0) process.exit(1);
