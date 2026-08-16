const CHAT_COOLDOWN_MS = 3000;
const CHAT_MAX_LENGTH = 60;

const PROFANITY_PATTERNS = [
  /\bamk\b/,
  /\baq\b/,
  /\bamq\b/,
  /\bmk\b/,
  /\bo[cç]\b/,
  /\bsg\b/,
  /\bsiktir\b/,
  /\bsikerim\b/,
  /\bsikeyim\b/,
  /\bsikim\b/,
  /\bsikik\b/,
  /\bsikis\b/,
  /\bsik\b/,
  /\byarra[kq]\b/,
  /\byarak\b/,
  /\byarram\b/,
  /\byavsa[kq]\b/,
  /\byavsak\b/,
  /\borospu\b/,
  /\boruspu\b/,
  /\bkahpe\b/,
  /\bpic\b/,
  /\bpezeven[kq]\b/,
  /\bgavat\b/,
  /\bamcik\b/,
  /\bamcuk\b/,
  /\bamına\b/,
  /\bamina\b/,
  /\bamını\b/,
  /\bamini\b/,
  /\bamına koy/,
  /\bamina koy/,
  /\bgotveren\b/,
  /\bgötveren\b/,
  /\bgöt\b/,
  /\bgot\b/,
  /\bmal\b/,
  /\bsalak\b/,
  /\baptal\b/,
  /\bgerizekali\b/,
  /\bgerizekalı\b/,
  /\bserefsiz\b/,
  /\bşerefsiz\b/,
  /\bpi[cç]\b/,
];

const COMPACT_PROFANITY = [
  'amk',
  'aq',
  'amq',
  'siktir',
  'sikerim',
  'sikeyim',
  'sikim',
  'sikik',
  'yarrak',
  'yarraq',
  'yarram',
  'orospu',
  'oruspu',
  'kahpe',
  'pezevenk',
  'pezevenq',
  'gavat',
  'amcik',
  'amcuk',
  'aminakoy',
  'gotveren',
  'serefsiz',
  'pic',
];

function normalizeText(text) {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[@]/g, 'a')
    .replace(/[!1|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');
}

function isCommand(text) {
  const trimmed = String(text || '').trim();
  return trimmed.startsWith('!') || trimmed.startsWith('/');
}

function isPrivileged(player, loggedInPlayers) {
  if (player && player.admin) return true;

  const userData = loggedInPlayers && loggedInPlayers.get(player.id);
  return !!(userData && userData.isadmin === 1);
}

function containsProfanity(text) {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/[^a-z0-9]/g, '');

  return PROFANITY_PATTERNS.some((pattern) => pattern.test(normalized))
    || COMPACT_PROFANITY.some((word) => compact.includes(word));
}

function createChatFilter({ cooldownMs = CHAT_COOLDOWN_MS } = {}) {
  const lastMessageAt = new Map();

  function check(player, text, { loggedInPlayers, now = Date.now() } = {}) {
    if (!player || typeof player.id === 'undefined') return { allowed: true };
    if (isPrivileged(player, loggedInPlayers)) return { allowed: true };
    if (isCommand(text)) return { allowed: true };

    if (String(text || '').length > CHAT_MAX_LENGTH) {
      return {
        allowed: false,
        reason: 'length',
        message: `⚠️ Mesaj çok uzun. En fazla ${CHAT_MAX_LENGTH} karakter yazabilirsin.`,
        color: 0xFFCC00,
      };
    }

    if (containsProfanity(text)) {
      return {
        allowed: false,
        reason: 'profanity',
        message: '⚠️ Küfürlü mesaj engellendi. Lütfen sohbet diline dikkat et.',
        color: 0xFFCC00,
      };
    }

    const last = lastMessageAt.get(player.id);
    if (!Number.isFinite(last)) {
      lastMessageAt.set(player.id, now);
      return { allowed: true };
    }

    const remainingMs = cooldownMs - (now - last);
    if (remainingMs > 0) {
      return {
        allowed: false,
        reason: 'cooldown',
        message: `⚠️ Sohbette flood yapma. ${Math.ceil(remainingMs / 1000)} sn sonra tekrar yazabilirsin.`,
        color: 0xFFCC00,
      };
    }

    lastMessageAt.set(player.id, now);
    return { allowed: true };
  }

  function forget(playerId) {
    lastMessageAt.delete(playerId);
  }

  return { check, forget };
}

module.exports = {
  CHAT_COOLDOWN_MS,
  CHAT_MAX_LENGTH,
  createChatFilter,
  containsProfanity,
  isCommand,
  normalizeText,
};
