function numberFromEnv(name, fallback, { min = null, max = null } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} sayısal olmalı.`);
  if (min !== null && value < min) throw new Error(`${name} en az ${min} olmalı.`);
  if (max !== null && value > max) throw new Error(`${name} en fazla ${max} olmalı.`);
  return value;
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase())) return false;
  throw new Error(`${name} boolean olmalı: 1/0, true/false, yes/no.`);
}

function listFromEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseColor(name, raw) {
  const value = String(raw).trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} renk formatı RRGGBB olmalı.`);
  return parseInt(value, 16);
}

function colorFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return parseColor(name, raw);
}

function colorListFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((item) => parseColor(`${name}[]`, item));
}

function capabilitiesFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return [...fallback];
  return raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function languageFromEnv() {
  const language = (
    process.env.ROOM_LANGUAGE
    || process.env.HAXBALL_LANGUAGE
    || process.env.LANGUAGE
    || process.env.language
    || 'tr'
  ).trim().toLowerCase();
  if (!['tr', 'en'].includes(language)) throw new Error('ROOM_LANGUAGE/LANGUAGE tr veya en olmalı.');
  return language;
}

const config = {
  room: {
    name: process.env.HAXBALL_ROOM_NAME || '🛰️🛰️ SPACEBOUNCE | ⚽ 4v4 🪐 🛰️🛰️',
    maxPlayers: numberFromEnv('HAXBALL_MAX_PLAYERS', 16, { min: 1, max: 30 }),
    scoreLimit: numberFromEnv('HAXBALL_SCORE_LIMIT', 3, { min: 0, max: 99 }),
    timeLimit: numberFromEnv('HAXBALL_TIME_LIMIT', 4, { min: 0, max: 99 }),
    promotionCount: numberFromEnv('HAXBALL_PROMOTION_COUNT', 4, { min: 1, max: 8 }),
    public: boolFromEnv('HAXBALL_PUBLIC', true),
    language: languageFromEnv(),
  },

  adminRules: {
    password: process.env.HAXBALL_ADMIN_PASSWORD || '',
    allowMultipleJoin: boolFromEnv('CONFIG_ALLOW_MULTIPLE_JOIN', false),
    roleCapabilities: {
      owner: capabilitiesFromEnv('ROLE_OWNER_CAPABILITIES', ['*']),
      admin: capabilitiesFromEnv('ROLE_ADMIN_CAPABILITIES', ['admin_chat', 'afk_exempt', 'auto', 'ban', 'blacklist', 'bot', 'clear_bans', 'duplicate_join_exempt', 'kick', 'mute', 'mute_exempt', 'native_admin']),
      mod: capabilitiesFromEnv('ROLE_MOD_CAPABILITIES', ['admin_chat', 'afk_exempt', 'auto', 'kick', 'mute', 'mute_exempt', 'native_admin']),
      vip: capabilitiesFromEnv('ROLE_VIP_CAPABILITIES', []),
      player: capabilitiesFromEnv('ROLE_PLAYER_CAPABILITIES', []),
    },
  },

  bot: {
    baseName: process.env.HAXBALL_BOT_NAME || 'SpaceBot',
    names: listFromEnv('HAXBALL_BOT_NAMES', ['Salah', 'Škriniar', 'Osimhen', 'Trossard', 'Messi', 'Ronaldo', 'Hakimi', 'Kimmich']),
    max: numberFromEnv('HAXBALL_BOT_MAX', 8, { min: 0, max: 16 }),
    avatar: process.env.HAXBALL_BOT_AVATAR || '🤖',
    autostart: numberFromEnv('HAXBALL_BOT_AUTOSTART', 4, { min: 0, max: 16 }),
  },

  chat: {
    cooldownMs: numberFromEnv('CHAT_COOLDOWN_MS', 3000, { min: 0 }),
    maxLength: numberFromEnv('CHAT_MAX_LENGTH', 60, { min: 1, max: 500 }),
    adminColor: colorFromEnv('CHAT_ADMIN_COLOR', 0xCC99FF),
    normalColor: colorFromEnv('CHAT_NORMAL_COLOR', 0xFFFFFF),
  },

  adminRequests: {
    cooldownMs: numberFromEnv('ADMIN_REQUEST_COOLDOWN_MS', 15 * 60 * 1000, { min: 0 }),
    announceMs: numberFromEnv('ADMIN_REQUEST_ANNOUNCE_MS', 5 * 60 * 1000, { min: 0 }),
  },

  afk: {
    cooldownMs: numberFromEnv('AFK_COOLDOWN_MS', 10 * 60 * 1000, { min: 0 }),
    minDurationMs: numberFromEnv('AFK_MIN_DURATION_MS', 30 * 1000, { min: 0 }),
    maxDurationMs: numberFromEnv('AFK_MAX_DURATION_MS', 15 * 60 * 1000, { min: 0 }),
    earlyWarningMs: numberFromEnv('AFK_EARLY_WARNING_MS', 10 * 1000, { min: 0 }),
  },

  inactivity: {
    kickMs: numberFromEnv('INACTIVITY_KICK_MS', 30 * 1000, { min: 0 }),
    warningMs: numberFromEnv('INACTIVITY_WARNING_MS', 25 * 1000, { min: 0 }),
    checkMs: numberFromEnv('INACTIVITY_CHECK_MS', 1000, { min: 250 }),
  },

  autoManagement: {
    restoreCheckMs: numberFromEnv('AUTO_RESTORE_CHECK_MS', 30 * 1000, { min: 1000 }),
  },

  teamColors: {
    red: {
      team: 1,
      angle: numberFromEnv('TEAM_COLOR_RED_ANGLE', 60, { min: 0, max: 360 }),
      text: colorFromEnv('TEAM_COLOR_RED_TEXT', 0xE3E3E3),
      colors: colorListFromEnv('TEAM_COLOR_RED_COLORS', [0xC90209]),
    },
    blue: {
      team: 2,
      angle: numberFromEnv('TEAM_COLOR_BLUE_ANGLE', 60, { min: 0, max: 360 }),
      text: colorFromEnv('TEAM_COLOR_BLUE_TEXT', 0xE3E3E3),
      colors: colorListFromEnv('TEAM_COLOR_BLUE_COLORS', [0x0272BD]),
    },
  },
};

function validateConfig(cfg = config) {
  if (cfg.bot.autostart > cfg.bot.max) {
    throw new Error('HAXBALL_BOT_AUTOSTART, HAXBALL_BOT_MAX değerinden büyük olamaz.');
  }
  if (cfg.afk.maxDurationMs > 0 && cfg.afk.minDurationMs > cfg.afk.maxDurationMs) {
    throw new Error('AFK_MIN_DURATION_MS, AFK_MAX_DURATION_MS değerinden büyük olamaz.');
  }
  if (cfg.inactivity.warningMs > cfg.inactivity.kickMs) {
    throw new Error('INACTIVITY_WARNING_MS, INACTIVITY_KICK_MS değerinden büyük olamaz.');
  }
  if (cfg.teamColors.red.colors.length === 0 || cfg.teamColors.blue.colors.length === 0) {
    throw new Error('TEAM_COLOR_*_COLORS en az bir renk içermeli.');
  }
  for (const [role, capabilities] of Object.entries(cfg.adminRules.roleCapabilities)) {
    if (!Array.isArray(capabilities)) throw new Error(`${role} capabilities liste olmalı.`);
    if (capabilities.some((capability) => !capability)) throw new Error(`${role} capabilities boş değer içeremez.`);
  }
  return cfg;
}

module.exports = validateConfig(config);
