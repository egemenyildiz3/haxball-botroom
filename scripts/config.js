const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  profile: 'spacebounce-v4',

  room: {
    name: '🛰️🛰️ SPACEBOUNCE | ⚽ 4v4 🪐 🛰️🛰️',
    maxPlayers: 16,
    scoreLimit: 3,
    timeLimit: 4,
    promotionCount: 4,
    public: true,
    language: 'en',
    geo: {
      code: 'tr',
      lat: 37.0208,
      lon: 30.8541,
    },
  },

  map: {
    file: 'maps/SpacebounceV4.hbs',
  },

  database: {
    file: 'db/haxball-results.sqlite',
  },

  sharedDatabase: {
    file: 'db/haxball-shared.sqlite',
  },

  adminRules: {
    allowMultipleJoin: false,
    roleCapabilities: {
      owner: ['*'],
      admin: ['admin_chat', 'afk_exempt', 'auto', 'ban', 'blacklist', 'bot', 'clear_bans', 'duplicate_join_exempt', 'kick', 'mute', 'mute_exempt', 'native_admin', 'unmute'],
      mod: ['admin_chat', 'afk_exempt', 'auto', 'kick', 'mute', 'mute_exempt', 'native_admin', 'unmute'],
      vip: [],
      player: [],
    },
  },

  bot: {
    baseName: 'SpaceBot',
    brain: 'balanced',
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
    roleColors: {
      owner: 'CC99FF',
      admin: 'FFD166',
      mod: 'FF6B6B',
      vip: 'FFE066',
    },
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

  teamManagement: {
    maxTeamSize: 4,
    maxActivePlayers: 8,
    promotionNotice: {
      enabled: true,
      color: 'FFCC00',
    },
  },

  ballRecovery: {
    safeMargin: 80,
    bounds: {
      minX: -1200,
      maxX: 1200,
      minY: -600,
      maxY: 600,
      goalMinY: -110,
      goalMaxY: 110,
    },
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

function readJsonFile(file, label) {
  if (!file || !fs.existsSync(file)) return {};

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${label} okunamadı (${file}): ${err.message}`);
  }
}

function readJsonConfig() {
  return readJsonFile(configPath(), 'CONFIG_FILE');
}

function profilePath(profileName) {
  if (process.env.PROFILE_FILE) return process.env.PROFILE_FILE;
  if (!profileName) return '';
  return path.join(__dirname, '..', 'profiles', `${profileName}.json`);
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

const baseFileConfig = deepMerge(DEFAULT_CONFIG, readJsonConfig());
const selectedProfile = (
  process.env.ROOM_PROFILE
  || process.env.HAXBALL_ROOM_PROFILE
  || baseFileConfig.profile
  || DEFAULT_CONFIG.profile
).trim();
const fileConfig = deepMerge(baseFileConfig, readJsonFile(profilePath(selectedProfile), 'PROFILE_FILE'));

const config = {
  profile: selectedProfile,

  room: {
    name: process.env.HAXBALL_ROOM_NAME || fileConfig.room.name,
    maxPlayers: numberFromEnv('HAXBALL_MAX_PLAYERS', fileConfig.room.maxPlayers, { min: 1, max: 30 }),
    scoreLimit: numberFromEnv('HAXBALL_SCORE_LIMIT', fileConfig.room.scoreLimit, { min: 0, max: 99 }),
    timeLimit: numberFromEnv('HAXBALL_TIME_LIMIT', fileConfig.room.timeLimit, { min: 0, max: 99 }),
    promotionCount: numberFromEnv('HAXBALL_PROMOTION_COUNT', fileConfig.room.promotionCount, { min: 1, max: 8 }),
    public: boolFromEnv('HAXBALL_PUBLIC', fileConfig.room.public),
    language: languageFromEnv(fileConfig.room.language),
    geo: {
      code: (process.env.HAXBALL_GEO_CODE || fileConfig.room.geo.code || 'tr').trim().toLowerCase(),
      lat: numberFromEnv('HAXBALL_GEO_LAT', fileConfig.room.geo.lat, { min: -90, max: 90 }),
      lon: numberFromEnv('HAXBALL_GEO_LON', fileConfig.room.geo.lon, { min: -180, max: 180 }),
    },
  },

  map: {
    file: process.env.HAXBALL_MAP_FILE || fileConfig.map.file,
  },

  database: {
    file: process.env.HAXBALL_DB_FILE || fileConfig.database.file,
  },

  sharedDatabase: {
    file: process.env.HAXBALL_SHARED_DB_FILE || fileConfig.sharedDatabase.file,
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
    brain: process.env.HAXBALL_BOT_BRAIN || fileConfig.bot.brain,
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
    roleColors: {
      owner: colorFromEnv('CHAT_OWNER_COLOR', fileConfig.chat.roleColors.owner),
      admin: colorFromEnv('CHAT_ADMIN_ROLE_COLOR', fileConfig.chat.roleColors.admin),
      mod: colorFromEnv('CHAT_MOD_COLOR', fileConfig.chat.roleColors.mod),
      vip: colorFromEnv('CHAT_VIP_COLOR', fileConfig.chat.roleColors.vip),
    },
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

  teamManagement: {
    maxTeamSize: numberFromEnv('TEAM_MAX_SIZE', fileConfig.teamManagement.maxTeamSize, { min: 1, max: 8 }),
    maxActivePlayers: numberFromEnv('TEAM_MAX_ACTIVE_PLAYERS', fileConfig.teamManagement.maxActivePlayers, { min: 2, max: 16 }),
    promotionNotice: {
      enabled: boolFromEnv('TEAM_PROMOTION_NOTICE_ENABLED', fileConfig.teamManagement.promotionNotice.enabled),
      color: colorFromEnv('TEAM_PROMOTION_NOTICE_COLOR', fileConfig.teamManagement.promotionNotice.color),
    },
  },

  ballRecovery: {
    safeMargin: numberFromEnv('BALL_RECOVERY_SAFE_MARGIN', fileConfig.ballRecovery.safeMargin, { min: 0, max: 500 }),
    bounds: {
      minX: numberFromEnv('BALL_RECOVERY_MIN_X', fileConfig.ballRecovery.bounds.minX, { min: -10000, max: 10000 }),
      maxX: numberFromEnv('BALL_RECOVERY_MAX_X', fileConfig.ballRecovery.bounds.maxX, { min: -10000, max: 10000 }),
      minY: numberFromEnv('BALL_RECOVERY_MIN_Y', fileConfig.ballRecovery.bounds.minY, { min: -10000, max: 10000 }),
      maxY: numberFromEnv('BALL_RECOVERY_MAX_Y', fileConfig.ballRecovery.bounds.maxY, { min: -10000, max: 10000 }),
      goalMinY: numberFromEnv('BALL_RECOVERY_GOAL_MIN_Y', fileConfig.ballRecovery.bounds.goalMinY, { min: -10000, max: 10000 }),
      goalMaxY: numberFromEnv('BALL_RECOVERY_GOAL_MAX_Y', fileConfig.ballRecovery.bounds.goalMaxY, { min: -10000, max: 10000 }),
    },
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
  if (!cfg.map || !cfg.map.file) {
    throw new Error('map.file config eksik.');
  }
  if (!cfg.database || !cfg.database.file) {
    throw new Error('database.file config eksik.');
  }
  if (cfg.bot.autostart > cfg.bot.max) {
    throw new Error('HAXBALL_BOT_AUTOSTART, HAXBALL_BOT_MAX değerinden büyük olamaz.');
  }
  if (!['balanced', 'smallPitch'].includes(cfg.bot.brain)) {
    throw new Error('HAXBALL_BOT_BRAIN balanced veya smallPitch olmalı.');
  }
  if (cfg.teamManagement.maxActivePlayers > cfg.teamManagement.maxTeamSize * 2) {
    throw new Error('TEAM_MAX_ACTIVE_PLAYERS, TEAM_MAX_SIZE * 2 değerinden büyük olamaz.');
  }
  if (cfg.teamManagement.maxActivePlayers % 2 !== 0) {
    throw new Error('TEAM_MAX_ACTIVE_PLAYERS çift sayı olmalı.');
  }
  if (cfg.ballRecovery.bounds.minX >= cfg.ballRecovery.bounds.maxX) {
    throw new Error('BALL_RECOVERY_MIN_X, BALL_RECOVERY_MAX_X değerinden küçük olmalı.');
  }
  if (cfg.ballRecovery.bounds.minY >= cfg.ballRecovery.bounds.maxY) {
    throw new Error('BALL_RECOVERY_MIN_Y, BALL_RECOVERY_MAX_Y değerinden küçük olmalı.');
  }
  if (cfg.ballRecovery.bounds.goalMinY >= cfg.ballRecovery.bounds.goalMaxY) {
    throw new Error('BALL_RECOVERY_GOAL_MIN_Y, BALL_RECOVERY_GOAL_MAX_Y değerinden küçük olmalı.');
  }
  if (cfg.room.promotionCount > cfg.teamManagement.maxTeamSize) {
    throw new Error('HAXBALL_PROMOTION_COUNT, TEAM_MAX_SIZE değerinden büyük olamaz.');
  }
  if (!/^[a-z]{2}$/.test(cfg.room.geo.code)) {
    throw new Error('HAXBALL_GEO_CODE iki harfli ülke kodu olmalı.');
  }
  if (cfg.afk.maxDurationMs > 0 && cfg.afk.minDurationMs > cfg.afk.maxDurationMs) {
    throw new Error('AFK_MIN_DURATION_MS, AFK_MAX_DURATION_MS değerinden büyük olamaz.');
  }
  if (cfg.inactivity.warningMs > cfg.inactivity.kickMs) {
    throw new Error('INACTIVITY_WARNING_MS, INACTIVITY_KICK_MS değerinden büyük olamaz.');
  }
  if (!cfg.teamManagement || !cfg.teamManagement.promotionNotice) {
    throw new Error('teamManagement.promotionNotice config eksik.');
  }
  if (!Number.isInteger(cfg.teamManagement.promotionNotice.color)) {
    throw new Error('TEAM_PROMOTION_NOTICE_COLOR renk formatı RRGGBB olmalı.');
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
