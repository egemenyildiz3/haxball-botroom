function getTimestamp() {
  if (typeof Temporal !== 'undefined' && typeof Temporal.Now !== 'undefined') {
    return Temporal.Now.zonedDateTimeISO('Europe/Amsterdam').toString({ fractionalSecondDigits: 3, timeZoneName: 'never' });
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Amsterdam',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const offset = now.getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hoursOffset = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutesOffset = String(absOffset % 60).padStart(2, '0');

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(now.getMilliseconds()).padStart(3, '0')}${sign}${hoursOffset}:${minutesOffset}`;
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
