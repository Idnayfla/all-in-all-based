/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'C:\\Users\\Hus Alfyandi\\.vscode\\all-in-all-based';
const MEMORY_FILE =
  'C:\\Users\\Hus Alfyandi\\.claude\\projects\\C--Users-Hus-Alfyandi--vscode-all-in-all-based\\memory\\session-last.md';

function run(cmd) {
  try {
    return execSync(cmd, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const branch = run('git branch --show-current');
const modified = run('git status --short');
const recentCommits = run('git log --oneline -5');
const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

const content = `---
name: session-last
description: Auto-saved state from last session — branch, modified files, recent commits
metadata:
  type: project
---

**Saved:** ${timestamp}
**Branch:** ${branch || 'unknown'}

## Modified Files
${modified ? '```\n' + modified + '\n```' : '_none_'}

## Recent Commits
\`\`\`
${recentCommits || 'none'}
\`\`\`
`;

fs.writeFileSync(MEMORY_FILE, content, 'utf8');
