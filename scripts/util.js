function getTimestamp() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Amsterdam',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return formatter.format(new Date());
}

function sanitizeStadiumFileContents(contents) {
  let inString = false;
  let escape = false;
  let result = '';

  for (const char of contents) {
    if (char === '\\' && !escape) {
      escape = true;
      result += char;
      continue;
    }
    if (char === '"' && !escape) {
      inString = !inString;
      result += char;
      continue;
    }
    if (char === '\n' && inString) {
      result += '\\n';
    } else {
      result += char;
    }
    escape = false;
  }
  return result;
}

function getCleanName(player) {
  const raw = player ? (player.name || '') : '';
  return String(raw).replace(/^\[\d{3}\]\s*/, '').trim();
}

function normalizeCmd(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  getTimestamp,
  sanitizeStadiumFileContents,
  getCleanName,
  normalizeCmd,
  sleep,
};
