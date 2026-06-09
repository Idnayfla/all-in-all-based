'use strict';
/**
 * Persistent memory for Based HQ Discord bot.
 *
 * Two layers:
 *   histories.json — per-channel conversation history (survives restarts)
 *   memories.json  — per-agent long-term memory summaries (extracted by Haiku)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const HISTORIES_FILE = path.join(DATA_DIR, 'histories.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Load / save helpers ────────────────────────────────────────────────────────
function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Histories — { channelId: [{ role, content }] } ────────────────────────────
const _histories = loadJSON(HISTORIES_FILE, {});

function getHistory(channelId) {
  if (!_histories[channelId]) _histories[channelId] = [];
  return _histories[channelId];
}

function pushHistory(channelId, role, content) {
  const h = getHistory(channelId);
  h.push({ role, content });
  while (h.length > 40) h.shift(); // keep last 40 messages
  saveJSON(HISTORIES_FILE, _histories);
}

function clearHistory(channelId) {
  delete _histories[channelId];
  saveJSON(HISTORIES_FILE, _histories);
}

// ── Memories — { agentSlug: "memory text" } ───────────────────────────────────
const _memories = loadJSON(MEMORIES_FILE, {});

function getMemory(slug) {
  return _memories[slug] || '';
}

function setMemory(slug, text) {
  _memories[slug] = text;
  saveJSON(MEMORIES_FILE, _memories);
}

// ── Memory extraction — runs after a conversation turn ────────────────────────
async function extractMemory(slug, history, anthropic, model) {
  if (!anthropic || history.length < 2) return;

  const conversation = history
    .map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : ''}`)
    .join('\n');

  const existing = getMemory(slug);

  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You extract memory for an AI agent named ${slug} in a Discord team server.

EXISTING MEMORY:
${existing || 'None yet'}

RECENT CONVERSATION:
${conversation}

Extract key facts worth remembering: ongoing projects, decisions made, preferences, context that will matter in future conversations. Merge with existing memory. Return ONLY a plain numbered list, max 15 items. No markdown, no headers. If nothing new, return existing memory unchanged.`,
        },
      ],
    });

    const text = res.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    if (text) setMemory(slug, text);
  } catch {
    // non-critical — memory extraction failures are silent
  }
}

module.exports = { getHistory, pushHistory, clearHistory, getMemory, setMemory, extractMemory };
