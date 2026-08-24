const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  room: {
    name: '🛰️🛰️ SPACEBOUNCE | ⚽ 4v4 🪐 🛰️🛰️',
    maxPlayers: 16,
    scoreLimit: 3,
    timeLimit: 4,
    promotionCount: 4,
    public: true,
    language: 'tr',
  },

  adminRules: {
    allowMultipleJoin: false,
    roleCapabilities: {
      owner: ['*'],
      admin: ['admin_chat', 'afk_exempt', 'auto', 'ban', 'blacklist', 'bot', 'clear_bans', 'duplicate_join_exempt', 'kick', 'mute', 'mute_exempt', 'native_admin', 'unmute'],
      mod: ['admin_chat', 'afk_exempt', 'auto', 'kick', 'mute', 'mute_exempt', 'native_admin', 'unmute'],
      vip: ['unmute'],
      player: [],
    },
  },

  bot: {
    baseName: 'SpaceBot',
    names: ['Salah', 'Škriniar', 'Osimhen', 'Trossard', 'Messi', 'Ronaldo', 'Hakimi', 'Kimmich'],
    max: 8,
    avatar: '🤖',
    autostart: 4,
    telemetry: false,
    telemetryEveryTicks: 120,
  },

  chat: {
    cooldownMs: 3000,
    maxLength: 60,
    adminColor: 'CC99FF',
    normalColor: 'FFFFFF',
  },

  adminRequests: {
    cooldownMs: 15 * 60 * 1000,
    announceMs: 5 * 60 * 1000,
  },

  afk: {
    cooldownMs: 10 * 60 * 1000,
    minDurationMs: 30 * 1000,
    maxDurationMs: 15 * 60 * 1000,
    earlyWarningMs: 10 * 1000,
  },

  inactivity: {
    kickMs: 30 * 1000,
    warningMs: 25 * 1000,
    checkMs: 1000,
  },

  autoManagement: {
    restoreCheckMs: 30 * 1000,
  },

  logging: {
    enabled: true,
    jsonl: true,
    dir: path.join(__dirname, '..', 'logs'),
    retentionDays: 14,
  },

  teamColors: {
    red: {
      team: 1,
      angle: 60,
      text: 'E3E3E3',
      colors: ['C90209'],
    },
    blue: {
      team: 2,
      angle: 60,
      text: 'E3E3E3',
      colors: ['0272BD'],
    },
  },
};

function configPath() {
  return process.env.CONFIG_FILE
    || path.join(__dirname, '..', 'config', 'config.json');
}

function readJsonConfig() {
  const file = configPath();
  if (!file || !fs.existsSync(file)) return {};

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`CONFIG_FILE okunamadı (${file}): ${err.message}`);
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return result;
}

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
  if (raw === undefined || raw === '') return !!fallback;
  if (['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(String(raw).toLowerCase())) return false;
  throw new Error(`${name} boolean olmalı: 1/0, true/false, yes/no.`);
}

function listFromEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return Array.isArray(fallback) ? fallback : [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseColor(name, raw) {
  if (Number.isInteger(raw)) return raw;
  const value = String(raw).trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} renk formatı RRGGBB olmalı.`);
  return parseInt(value, 16);
}

function colorFromEnv(name, fallback) {
  const raw = process.env[name];
  return parseColor(name, raw === undefined || raw === '' ? fallback : raw);
}

function colorListFromEnv(name, fallback) {
  const raw = process.env[name];
  const values = raw
    ? raw.split(',').map((item) => item.trim()).filter(Boolean)
    : (Array.isArray(fallback) ? fallback : []);
  return values.map((item) => parseColor(`${name}[]`, item));
}

function capabilitiesFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return Array.isArray(fallback) ? [...fallback] : [];
  return raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function languageFromEnv(fallback) {
  const language = (
    process.env.ROOM_LANGUAGE
    || process.env.HAXBALL_LANGUAGE
    || process.env.LANGUAGE
    || process.env.language
    || fallback
    || 'tr'
  ).trim().toLowerCase();
  if (!['tr', 'en'].includes(language)) throw new Error('ROOM_LANGUAGE/LANGUAGE tr veya en olmalı.');
  return language;
}

const fileConfig = deepMerge(DEFAULT_CONFIG, readJsonConfig());

const config = {
  room: {
    name: process.env.HAXBALL_ROOM_NAME || fileConfig.room.name,
    maxPlayers: numberFromEnv('HAXBALL_MAX_PLAYERS', fileConfig.room.maxPlayers, { min: 1, max: 30 }),
    scoreLimit: numberFromEnv('HAXBALL_SCORE_LIMIT', fileConfig.room.scoreLimit, { min: 0, max: 99 }),
    timeLimit: numberFromEnv('HAXBALL_TIME_LIMIT', fileConfig.room.timeLimit, { min: 0, max: 99 }),
    promotionCount: numberFromEnv('HAXBALL_PROMOTION_COUNT', fileConfig.room.promotionCount, { min: 1, max: 8 }),
    public: boolFromEnv('HAXBALL_PUBLIC', fileConfig.room.public),
    language: languageFromEnv(fileConfig.room.language),
  },

  adminRules: {
    password: process.env.HAXBALL_ADMIN_PASSWORD || '',
    allowMultipleJoin: boolFromEnv('CONFIG_ALLOW_MULTIPLE_JOIN', fileConfig.adminRules.allowMultipleJoin),
    roleCapabilities: {
      owner: capabilitiesFromEnv('ROLE_OWNER_CAPABILITIES', fileConfig.adminRules.roleCapabilities.owner),
      admin: capabilitiesFromEnv('ROLE_ADMIN_CAPABILITIES', fileConfig.adminRules.roleCapabilities.admin),
      mod: capabilitiesFromEnv('ROLE_MOD_CAPABILITIES', fileConfig.adminRules.roleCapabilities.mod),
      vip: capabilitiesFromEnv('ROLE_VIP_CAPABILITIES', fileConfig.adminRules.roleCapabilities.vip),
      player: capabilitiesFromEnv('ROLE_PLAYER_CAPABILITIES', fileConfig.adminRules.roleCapabilities.player),
    },
  },

  bot: {
    baseName: process.env.HAXBALL_BOT_NAME || fileConfig.bot.baseName,
    names: listFromEnv('HAXBALL_BOT_NAMES', fileConfig.bot.names),
    max: numberFromEnv('HAXBALL_BOT_MAX', fileConfig.bot.max, { min: 0, max: 16 }),
    avatar: process.env.HAXBALL_BOT_AVATAR || fileConfig.bot.avatar,
    autostart: numberFromEnv('HAXBALL_BOT_AUTOSTART', fileConfig.bot.autostart, { min: 0, max: 16 }),
    telemetry: boolFromEnv('HAXBALL_BOT_TELEMETRY', fileConfig.bot.telemetry),
    telemetryEveryTicks: numberFromEnv(
      'HAXBALL_BOT_TELEMETRY_EVERY_TICKS',
      fileConfig.bot.telemetryEveryTicks,
      { min: 1, max: 3600 }
    ),
  },

  chat: {
    cooldownMs: numberFromEnv('CHAT_COOLDOWN_MS', fileConfig.chat.cooldownMs, { min: 0 }),
    maxLength: numberFromEnv('CHAT_MAX_LENGTH', fileConfig.chat.maxLength, { min: 1, max: 500 }),
    adminColor: colorFromEnv('CHAT_ADMIN_COLOR', fileConfig.chat.adminColor),
    normalColor: colorFromEnv('CHAT_NORMAL_COLOR', fileConfig.chat.normalColor),
  },

  adminRequests: {
    cooldownMs: numberFromEnv('ADMIN_REQUEST_COOLDOWN_MS', fileConfig.adminRequests.cooldownMs, { min: 0 }),
    announceMs: numberFromEnv('ADMIN_REQUEST_ANNOUNCE_MS', fileConfig.adminRequests.announceMs, { min: 0 }),
  },

  afk: {
    cooldownMs: numberFromEnv('AFK_COOLDOWN_MS', fileConfig.afk.cooldownMs, { min: 0 }),
    minDurationMs: numberFromEnv('AFK_MIN_DURATION_MS', fileConfig.afk.minDurationMs, { min: 0 }),
    maxDurationMs: numberFromEnv('AFK_MAX_DURATION_MS', fileConfig.afk.maxDurationMs, { min: 0 }),
    earlyWarningMs: numberFromEnv('AFK_EARLY_WARNING_MS', fileConfig.afk.earlyWarningMs, { min: 0 }),
  },

  inactivity: {
    kickMs: numberFromEnv('INACTIVITY_KICK_MS', fileConfig.inactivity.kickMs, { min: 0 }),
    warningMs: numberFromEnv('INACTIVITY_WARNING_MS', fileConfig.inactivity.warningMs, { min: 0 }),
    checkMs: numberFromEnv('INACTIVITY_CHECK_MS', fileConfig.inactivity.checkMs, { min: 250 }),
  },

  autoManagement: {
    restoreCheckMs: numberFromEnv('AUTO_RESTORE_CHECK_MS', fileConfig.autoManagement.restoreCheckMs, { min: 1000 }),
  },

  logging: {
    enabled: boolFromEnv('LOGGING_ENABLED', fileConfig.logging.enabled),
    jsonl: boolFromEnv('LOGGING_JSONL', fileConfig.logging.jsonl),
    dir: process.env.LOGGING_DIR || fileConfig.logging.dir,
    retentionDays: numberFromEnv('LOGGING_RETENTION_DAYS', fileConfig.logging.retentionDays, { min: 0, max: 365 }),
  },

  teamColors: {
    red: {
      team: 1,
      angle: numberFromEnv('TEAM_COLOR_RED_ANGLE', fileConfig.teamColors.red.angle, { min: 0, max: 360 }),
      text: colorFromEnv('TEAM_COLOR_RED_TEXT', fileConfig.teamColors.red.text),
      colors: colorListFromEnv('TEAM_COLOR_RED_COLORS', fileConfig.teamColors.red.colors),
    },
    blue: {
      team: 2,
      angle: numberFromEnv('TEAM_COLOR_BLUE_ANGLE', fileConfig.teamColors.blue.angle, { min: 0, max: 360 }),
      text: colorFromEnv('TEAM_COLOR_BLUE_TEXT', fileConfig.teamColors.blue.text),
      colors: colorListFromEnv('TEAM_COLOR_BLUE_COLORS', fileConfig.teamColors.blue.colors),
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
