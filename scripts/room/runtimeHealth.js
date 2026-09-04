const WARNING_WINDOW_MS = 10 * 1000;

let restartScheduled = false;
const warningWindows = new Map();

function errorMessage(err) {
  return err && err.message ? err.message : String(err || '');
}

function errorStack(err) {
  return err && err.stack ? err.stack : '';
}

function isHeadlessRoomLostError(err) {
  const message = errorMessage(err);
  const stack = errorStack(err);
  return /Cannot read properties of null \(reading '(getPlayer|players)'\)/.test(message)
    && stack.includes('node-haxball/src/headlessWrapper.js');
}

function warnRateLimited(label, err, windowMs = WARNING_WINDOW_MS) {
  const message = errorMessage(err);
  const key = `${label}:${message}`;
  const now = Date.now();
  const lastWarnAt = warningWindows.get(key) || 0;

  if (now - lastWarnAt <= windowMs) return;
  warningWindows.set(key, now);
  console.warn(label, message);
}

function scheduleProcessRestart(reason) {
  if (restartScheduled) return;
  restartScheduled = true;
  console.error(`[ROOM HEALTH] ${reason} Process kontrollü şekilde kapatılacak; Docker restart policy odayı yeniden açmalı.`);
  setTimeout(() => process.exit(1), 250);
}

function handleRoomReadError(context, err) {
  warnRateLimited(`[${context}] Oda state'i okunamadı:`, err);
  if (isHeadlessRoomLostError(err)) {
    scheduleProcessRestart('node-haxball iç oda objesi kayboldu.');
  }
}

module.exports = {
  handleRoomReadError,
  isHeadlessRoomLostError,
  scheduleProcessRestart,
  warnRateLimited,
};
