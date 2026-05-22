const { spawnSync } = require('child_process');
const http = require('http');
const electronPath = require('electron');

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
