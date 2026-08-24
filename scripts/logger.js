const fs = require('fs');
const path = require('path');
const util = require('util');

const CONSOLE_EVENT = 'console';
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function localParts(date = new Date(), timeZone = 'Europe/Amsterdam') {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function safeJson(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, item) => {
    if (typeof item === 'bigint') return String(item);
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
      };
    }
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
    }
    return item;
  });
}

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  );
}

function createLogger(options = {}) {
  const enabled = options.enabled !== false;
  const jsonl = options.jsonl !== false;
  const dir = options.dir || path.join(__dirname, '..', 'logs');
  const retentionDays = Number.isFinite(options.retentionDays) ? options.retentionDays : 14;
  const timeZone = options.timeZone || process.env.TZ || 'Europe/Amsterdam';
  const originalConsole = {
    log: console.log.bind(console),
    info: (console.info || console.log).bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  let installed = false;
  let lastRetentionCheck = 0;

  function filePath(date = new Date()) {
    return path.join(dir, `room-${localParts(date, timeZone).date}.jsonl`);
  }

  function ensureDir() {
    if (!enabled || !jsonl) return false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (err) {
      originalConsole.warn(`[LOGGER] Log klasörü hazırlanamadı (${dir}): ${err.message}`);
      return false;
    }
  }

  function pruneOldFiles() {
    if (!enabled || !jsonl || retentionDays <= 0) return;
    const now = Date.now();
    if (now - lastRetentionCheck < 60 * 60 * 1000) return;
    lastRetentionCheck = now;

    if (!ensureDir()) return;
    const cutoff = now - retentionDays * DAY_MS;

    try {
      for (const name of fs.readdirSync(dir)) {
        const match = name.match(/^room-(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!match) continue;
        if (new Date(`${match[1]}T00:00:00Z`).getTime() < cutoff) {
          fs.unlinkSync(path.join(dir, name));
        }
      }
    } catch (err) {
      originalConsole.warn(`[LOGGER] Eski loglar temizlenemedi: ${err.message}`);
    }
  }

  function append(record) {
    if (!enabled || !jsonl) return;
    if (!ensureDir()) return;
    pruneOldFiles();

    try {
      fs.appendFileSync(filePath(), `${safeJson(record)}\n`);
    } catch (err) {
      originalConsole.warn(`[LOGGER] Log yazılamadı: ${err.message}`);
    }
  }

  function record(level, event, message, meta = {}) {
    const parts = localParts(new Date(), timeZone);
    append({
      ts: new Date().toISOString(),
      time: parts.time,
      level,
      event,
      message: String(message || ''),
      ...cleanMeta(meta),
    });
  }

  function write(level, event, message, meta = {}) {
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    originalConsole[method](message);
    record(level, event, message, meta);
  }

  function installConsole() {
    if (installed) return;
    installed = true;

    for (const method of ['log', 'info', 'warn', 'error']) {
      console[method] = (...args) => {
        originalConsole[method](...args);
        const message = util.format(...args);
        record(method === 'log' ? 'info' : method, CONSOLE_EVENT, message);
      };
    }
  }

  return {
    installConsole,
    info: (event, message, meta) => write('info', event, message, meta),
    warn: (event, message, meta) => write('warn', event, message, meta),
    error: (event, message, meta) => write('error', event, message, meta),
    event: (event, message, meta) => record('info', event, message, meta),
    filePath,
  };
}

module.exports = {
  createLogger,
};
