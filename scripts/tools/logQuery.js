const fs = require('fs');
const path = require('path');

const logDir = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
const limit = Math.max(1, Number(process.env.LIMIT || 50));
const eventFilter = String(process.env.EVENT || '').trim();
const userFilter = String(process.env.USERNAME || process.env.USER || '').trim().toLowerCase();
const levelFilter = String(process.env.LEVEL || '').trim().toLowerCase();

function listFiles() {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => /^room-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(logDir, name));
}

function matches(row) {
  if (eventFilter && row.event !== eventFilter) return false;
  if (levelFilter && row.level !== levelFilter) return false;
  if (userFilter) {
    const username = String(row.username || '').toLowerCase();
    const message = String(row.message || '').toLowerCase();
    if (!username.includes(userFilter) && !message.includes(userFilter)) return false;
  }
  return true;
}

function readRows() {
  const rows = [];
  for (const file of listFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (matches(row)) rows.push(row);
      } catch (err) {
        rows.push({
          time: '',
          level: 'warn',
          event: 'log_parse_error',
          message: `Parse edilemeyen log satırı: ${line.slice(0, 120)}`,
        });
      }
    }
  }
  return rows.slice(-limit);
}

const rows = readRows().map((row) => ({
  time: row.time || '',
  level: row.level || '',
  event: row.event || '',
  playerId: row.playerId || '',
  uid: row.uid || '',
  username: row.username || '',
  message: row.message || '',
}));

if (rows.length === 0) {
  console.log(`Log bulunamadı. Klasör: ${logDir}`);
} else {
  console.table(rows);
}
