const CHAT_COOLDOWN_MS = 3000;
const CHAT_MAX_LENGTH = 60;

const PROFANITY_PATTERNS = [
  // Kisa / internet kufurleri
  /\bamk\b/,
  /\bamq\b/,
  /\baq\b/,
  /\bmk\b/,
  /\boc\b/,
  /\boe\b/,
  /\bsg\b/,
  /\bsktr\b/,
  /\bskm\b/,

  // Sik turevleri
  /\bsik\b/,
  /\bsiktir\b/,
  /\bsiktirgit\b/,
  /\bsikerim\b/,
  /\bsikeyim\b/,
  /\bsikiyim\b/,
  /\bsikim\b/,
  /\bsikik\b/,
  /\bsikis\b/,
  /\bsikici\b/,
  /\bsikmek\b/,
  /\bsikilmek\b/,
  /\bsikilmis\b/,
  /\bsiktim\b/,
  /\bsiktin\b/,
  /\bsikti\b/,
  /\bsiktigim\b/,
  /\bsiktigimin\b/,
  /\bsikerler\b/,
  /\bsikertirim\b/,
  /\bsikicem\b/,
  /\bsikecem\b/,

  // Yarak turevleri
  /\byarak\b/,
  /\byarrak\b/,
  /\byarraq\b/,
  /\byarram\b/,
  /\byarramin\b/,
  /\byarragim\b/,
  /\byarragi\b/,
  /\byarragini\b/,
  /\byarragimin\b/,
  /\byarrakafa\b/,

  // Orospu turevleri
  /\borospu\b/,
  /\boruspu\b/,
  /\borosbi\b/,
  /\borospu cocugu\b/,
  /\borospu cocuklari\b/,
  /\borospu evladi\b/,
  /\borospu evlatlari\b/,
  /\borospunun\b/,
  /\borospuluk\b/,
  /\borospucocugu\b/,

  // Am / amcik turevleri
  /\bamcik\b/,
  /\bamcuk\b/,
  /\bamcig\b/,
  /\bamina\b/,
  /\bamini\b/,
  /\bamindan\b/,
  /\baminiza\b/,
  /\baminakoy\b/,
  /\bamina koy\b/,
  /\baminakoyayim\b/,
  /\bamina koyayim\b/,
  /\baminakodum\b/,
  /\bamina kodum\b/,
  /\baminakoyim\b/,
  /\bamina koyim\b/,
  /\bamkoyim\b/,

  // Got turevleri
  /\bgot\b/,
  /\bgote\b/,
  /\botune\b/,
  /\bgotun\b/,
  /\botunu\b/,
  /\bgotunden\b/,
  /\bgotveren\b/,
  /\bgotlek\b/,
  /\bgotoglani\b/,
  /\bgotoglan\b/,

  // Hakaretler
  /\bpic\b/,
  /\bpiclik\b/,
  /\bpicin\b/,
  /\bpicoglu\b/,
  /\bpicoglupic\b/,
  /\bpezevenk\b/,
  /\bpezevenklik\b/,
  /\bgavat\b/,
  /\bgavatlik\b/,
  /\byavsak\b/,
  /\byavsak\b/,
  /\byavsan\b/,
  /\bkahpe\b/,
  /\bkaltak\b/,
  /\bsurtuk\b/,
  /\bfahise\b/,
  /\bkerhane\b/,
  /\bdangalak\b/,
  /\bdallama\b/,
  /\bdalyarak\b/,
  /\bdalyarrak\b/,
  /\bdenyo\b/,
  /\bhiyar\b/,
  /\bgerizekali\b/,
  /\bgerzek\b/,
  /\bmal\b/,
  /\bsalak\b/,
  /\baptal\b/,
  /\bembesil\b/,
  /\bandaval\b/,
  /\bavanak\b/,
  /\bsersem\b/,
  /\bserrefsiz\b/,
  /\bserefsiz\b/,
  /\bhaysiyetsiz\b/,
  /\bonursuz\b/,
  /\bkaraktersiz\b/,
  /\bnamussuz\b/,
  /\badi\b/,
  /\balcak\b/,
  /\bpislik\b/,
  /\bit\b/,
  /\bkopek\b/,
  /\bitogluit\b/,
  /\bitoglu\b/,

  // Ana / aile uzerinden
  /\banani\b/,
  /\bananin\b/,
  /\banana\b/,
  /\banani sikerim\b/,
  /\banani sikeyim\b/,
  /\banani sikim\b/,
  /\banasini\b/,
  /\banasini sikerim\b/,
  /\banasini sikeyim\b/,
  /\banneni\b/,
  /\bannenin\b/,
  /\banneni sikerim\b/,
  /\banneni sikeyim\b/,
  /\bbacini\b/,
  /\bbacini sikerim\b/,

  // Diger yaygin ifadeler
  /\bsiktir git\b/,
  /\bsiktir ol git\b/,
  /\bsiktir lan\b/,
  /\bsiktir aq\b/,
  /\bsiktir amk\b/,
  /\bhassiktir\b/,
  /\bhassiktir\b/,
  /\bhassiktir lan\b/,
  /\bhassiktir aq\b/,
  /\bhassiktir amk\b/,
  /\bsiktimin\b/,
  /\bsiktigimin\b/,
  /\bamk cocugu\b/,
  /\bamk evladi\b/,
];


const COMPACT_PROFANITY = [
  // Kisaltmalar
  'amk',
  'amq',
  'aq',
  'mk',
  'oc',
  'oe',
  'sg',
  'sktr',
  'skm',

  // Sik
  'sik',
  'siktir',
  'siktirgit',
  'sikerim',
  'sikeyim',
  'sikiyim',
  'sikim',
  'sikik',
  'sikis',
  'sikici',
  'sikicem',
  'sikecem',
  'siktigim',
  'siktigimin',
  'sikertirim',

  // Yarak
  'yarak',
  'yarrak',
  'yarraq',
  'yarram',
  'yarramin',
  'yarragim',
  'yarragi',
  'yarragini',
  'yarragimin',
  'yarrakafa',
  'dalyarak',
  'dalyarrak',

  // Orospu
  'orospu',
  'oruspu',
  'orosbi',
  'orospucocugu',
  'orospuevladi',
  'orospunun',
  'orospuluk',

  // Am
  'amcik',
  'amcuk',
  'amcig',
  'amina',
  'amini',
  'amindan',
  'aminakoy',
  'aminakoyayim',
  'aminakoyim',
  'aminakodum',
  'amkoyim',

  // Got
  'got',
  'gotun',
  'gotunu',
  'gotunden',
  'gotveren',
  'gotlek',
  'gotoglan',
  'gotoglani',

  // Hakaret
  'pic',
  'piclik',
  'picoglu',
  'pezevenk',
  'gavat',
  'yavsak',
  'kahpe',
  'kaltak',
  'surtuk',
  'fahise',
  'dangalak',
  'dallama',
  'gerizekali',
  'gerzek',
  'embesil',
  'andaval',
  'serefsiz',
  'haysiyetsiz',
  'namussuz',
  'karaktersiz',
  'itoglu',
  'itogluit',

  // Aile
  'anani',
  'ananin',
  'anasini',
  'anneni',
  'annenin',
  'bacini',
  'ananisikerim',
  'ananisikeyim',
  'ananisikim',
  'annenisikerim',
  'annenisikeyim',
  'bacinisikerim',

  // Birlesik internet yazimlari
  'hassiktir',
  'siktirlan',
  'siktiraq',
  'siktiramk',
  'amkcocugu',
  'amkevladi',
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

function defaultT(key, vars = {}) {
  const messages = {
    'chat.tooLong': `⚠️ Mesaj çok uzun. En fazla ${vars.max} karakter yazabilirsin.`,
    'chat.profanity': '⚠️ Küfürlü mesaj gönderemezsin.',
    'chat.flood': `⚠️ Sohbette flood yapma. ${vars.seconds} sn sonra tekrar yazabilirsin.`,
  };
  return messages[key] || key;
}

function createChatFilter({ cooldownMs = CHAT_COOLDOWN_MS, maxLength = CHAT_MAX_LENGTH, t = defaultT } = {}) {
  const lastMessageAt = new Map();
  const lastCooldownWarningAt = new Map();
  const lastProfanityWarningAt = new Map();

  function check(player, text, { loggedInPlayers, now = Date.now() } = {}) {
    if (!player || typeof player.id === 'undefined') return { allowed: true };
    if (isPrivileged(player, loggedInPlayers)) return { allowed: true };
    if (isCommand(text)) return { allowed: true };

    if (String(text || '').length > maxLength) {
      return {
        allowed: false,
        reason: 'length',
        message: t('chat.tooLong', { max: maxLength }),
        color: 0xFFCC00,
      };
    }

    if (containsProfanity(text)) {
      const lastWarning = lastProfanityWarningAt.get(player.id);
      if (Number.isFinite(lastWarning) && now - lastWarning < cooldownMs) {
        return {
          allowed: false,
          reason: 'profanity-silent',
          silent: true,
        };
      }

      lastProfanityWarningAt.set(player.id, now);
      return {
        allowed: false,
        reason: 'profanity',
        message: t('chat.profanity'),
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
      const lastWarning = lastCooldownWarningAt.get(player.id);
      if (Number.isFinite(lastWarning) && now - lastWarning < cooldownMs) {
        return {
          allowed: false,
          reason: 'cooldown-silent',
          silent: true,
        };
      }

      lastCooldownWarningAt.set(player.id, now);
      return {
        allowed: false,
        reason: 'cooldown',
        message: t('chat.flood', { seconds: Math.ceil(remainingMs / 1000) }),
        color: 0xFFCC00,
      };
    }

    lastMessageAt.set(player.id, now);
    lastCooldownWarningAt.delete(player.id);
    lastProfanityWarningAt.delete(player.id);
    return { allowed: true };
  }

  function forget(playerId) {
    lastMessageAt.delete(playerId);
    lastCooldownWarningAt.delete(playerId);
    lastProfanityWarningAt.delete(playerId);
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
