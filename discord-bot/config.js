'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'config.json');
if (!fs.existsSync(FILE)) {
  console.error('\nERROR: config.json not found.\nRun: cp config.example.json config.json\n');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

module.exports = {
  config,
  PROJECT_ROOT: config.project_root || path.join(__dirname, '..'),
  AGENTS_DIR: config.agents_dir || path.join(__dirname, '..', '.claude', 'agents'),
  PROVIDER: config.provider || 'auto',
  MODEL_OPUS: config.model_opus || 'claude-fable-5',
  MODEL_SONNET: config.model_sonnet || 'claude-sonnet-4-6',
  MODEL_HAIKU: config.model_haiku || 'claude-haiku-4-5',
  MODEL_GROQ: config.model_groq || 'llama-3.3-70b-versatile',
  MODEL_OLLAMA: config.model_ollama || 'llama3.1:8b',
  OLLAMA_BASE_URL: config.ollama_base_url || 'http://localhost:11434',
  COUNCIL_CHANNEL: config.council_channel || 'council',
  STANDUP_HOUR_UTC: config.standup_hour_utc ?? 1, // 9am SGT = 1am UTC
};
