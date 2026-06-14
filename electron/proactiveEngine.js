const { powerMonitor } = require('electron');

const CHECK_INTERVAL_MS = 3 * 60 * 1000; // poll every 3 minutes
const MIN_IDLE_SECS = 60;                 // user idle at least 1 minute
const MAX_IDLE_SECS = 1800;              // but not more than 30 minutes (away from desk)
const MIN_TRIGGER_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours between triggers
const SGT_OFFSET_H = 8;

let lastTriggerAt = 0;
let intervalId = null;

function getSGTHour() {
  return (new Date().getUTCHours() + SGT_OFFSET_H) % 24;
}

function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function startProactiveEngine(getOverlayWin) {
  intervalId = setInterval(() => {
    try {
      const overlayWin = getOverlayWin();
      if (!overlayWin || overlayWin.isDestroyed()) return;

      const idleSecs = powerMonitor.getSystemIdleTime();
      const hour = getSGTHour();
      const now = Date.now();

      if (hour < 7 || hour >= 23) return;
      if (idleSecs < MIN_IDLE_SECS || idleSecs > MAX_IDLE_SECS) return;
      if (now - lastTriggerAt < MIN_TRIGGER_GAP_MS) return;

      lastTriggerAt = now;
      const context = getTimeOfDay(hour);
      console.log(`[proactive] idle=${idleSecs}s hour=${hour} context=${context}`);
      overlayWin.webContents.send('proactive-trigger', { context });
    } catch {
      // silent
    }
  }, CHECK_INTERVAL_MS);
}

function stopProactiveEngine() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { startProactiveEngine, stopProactiveEngine };
