const { spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const electronPath = require('electron');

// Load .env.local so Electron picks up GOOGLE_API_KEY and other local secrets
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

process.env.ELECTRON_DEV = 'true';

function waitForServer(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http
        .get(url, res => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Timed out waiting for dev server at ' + url));
          } else {
            setTimeout(check, 500);
          }
        });
    };
    check();
  });
}

console.log('Waiting for Next.js dev server at http://localhost:3000 ...');
waitForServer('http://localhost:3000')
  .then(() => {
    console.log('Dev server ready — launching Electron.');
    const result = spawnSync(electronPath, ['electron/main.js'], {
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(result.status ?? 0);
  })
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
