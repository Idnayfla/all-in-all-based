/**
 * Development launcher for Electron.
 * Sets ELECTRON_DEV=true so main.js uses localhost:3000 instead of production.
 * Usage: npm run electron:start  (calls this script)
 */
const { spawnSync } = require('child_process');
const electronPath = require('electron');

process.env.ELECTRON_DEV = 'true';

const result = spawnSync(electronPath, ['electron/main.js'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 0);
