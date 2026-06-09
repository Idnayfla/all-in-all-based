'use strict';
// Shared runtime state — imported by both bot.js and scheduler.js

let lastHusMessageAt = Date.now();

module.exports = {
  updateLastHusMessage: () => {
    lastHusMessageAt = Date.now();
  },
  getLastHusMessage: () => lastHusMessageAt,
};
