const fs = require('fs');
const path = require('path');
const { createHostRoom } = require('./bot/hostRoom');

const { getTimestamp, sanitizeStadiumFileContents, sleep } = require('./util');
const { loadOrCreateDatabase, persistDatabase, initDatabase } = require('./db');
const { createRoom } = require('./room');
const { createBotManager } = require('./bot/manager');
const config = require('./config');
const { createTranslator } = require('./i18n');
const { createLogger } = require('./logger');

const MAP_FILE = path.join(__dirname, '..', 'maps', 'Spacebounce.hbs');
const DB_FILE = path.join(__dirname, '..', 'db', 'haxball-results.sqlite');
const DEFAULT_TOKEN_FILE = '/run/haxball/spacebounce-botroom-token.txt';
const logger = createLogger(config.logging);
logger.installConsole();

function readToken() {
  const envToken = String(process.env.HAXBALL_TOKEN || '').trim();
  if (envToken) return envToken;

  const tokenFile = String(process.env.HAXBALL_TOKEN_FILE || DEFAULT_TOKEN_FILE).trim();
  if (!tokenFile) return '';

  try {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(`HAXBALL_TOKEN_FILE okunamadı (${tokenFile}): ${err.message}`);
    }
    return '';
  }
}

const TOKEN = readToken();
const t = createTranslator(config.room.language);

let SQL = null;
let db = null;

if (!TOKEN) {
  console.error('HAXBALL_TOKEN bulunamadı.');
  console.error(`Lütfen HAXBALL_TOKEN env değişkenini veya HAXBALL_TOKEN_FILE dosyasını tanımlayın. Varsayılan dosya: ${DEFAULT_TOKEN_FILE}`);
  process.exit(1);
}

const mapDataRaw = fs.readFileSync(MAP_FILE, 'utf8');
const mapData = sanitizeStadiumFileContents(mapDataRaw);
const playerAssignments = new Map();
const playerJoinOrder = new Map();
const loggedInPlayers = new Map();
const leavingIntentions = new Map();

startRoom().catch((error) => {
  console.error('Haxball odası başlatılamadı:', error);
  process.exit(1);
});

async function startRoom() {
  console.log(`${getTimestamp()} Haxball odası başlatılıyor...`);

  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  db = loadOrCreateDatabase(SQL, DB_FILE);
  initDatabase(db);
  persistDatabase(db, DB_FILE);

  const botManager = createBotManager({
    botName: config.bot.baseName,
    botNames: config.bot.names,
    maxBots: config.bot.max,
    avatar: config.bot.avatar,
    telemetry: config.bot.telemetry,
    telemetryEveryTicks: config.bot.telemetryEveryTicks,
    t,
    log: (message, meta) => logger.info('bot', message, meta),
  });

  const cleanupBots = () => botManager.stopAll();
  process.on('exit', cleanupBots);
  process.on('SIGTERM', () => { cleanupBots(); process.exit(0); });
  process.on('SIGINT', () => { cleanupBots(); process.exit(0); });

  const host = createHostRoom({
    roomName: config.room.name,
    playerName: 'Host-admin',
    maxPlayers: config.room.maxPlayers,
    public: config.room.public,
    noPlayer: false,
    token: TOKEN,
    geo: { code: 'tr', lat: 37.0208, lon: 30.8541 },
  });

  const room = host.room;

  // Ham oda nesnesi onOpen ile geliyor; hazır olunca botları bağla.
  const waitForRaw = setInterval(() => {
    const raw = host.getRaw();
    if (raw) {
      clearInterval(waitForRaw);
      botManager.attach(raw, host.api);
      console.log(`${getTimestamp()} 🤖 Bot motoru hazır.`);
    }
  }, 250);

  await createRoom(room, {
    ROOM_NAME: config.room.name,
    SCORE_LIMIT: config.room.scoreLimit,
    TIME_LIMIT: config.room.timeLimit,
    SPEC_PROMOTION_COUNT: config.room.promotionCount,
    mapData,
    db,
    DB_FILE,
    persistDatabase,
    ADMIN_PASSWORD: config.adminRules.password,
    playerAssignments,
    playerJoinOrder,
    loggedInPlayers,
    leavingIntentions,
    getTimestamp,
    sleep,
    CONFIG_ALLOW_MULTIPLE_JOIN: config.adminRules.allowMultipleJoin ? 1 : 0,
    botManager,
    config,
    t,
    logger,
  });

  if (config.bot.autostart > 0) {
    const autoStartBots = setInterval(() => {
      if (!botManager.isReady()) return;

      clearInterval(autoStartBots);
      const result = botManager.start(config.bot.autostart);
      const status = result.ok ? 'başlatıldı' : 'başlatılamadı';
      console.log(`${getTimestamp()} 🤖 Otomatik bot başlatma ${status}: ${result.message}`);
    }, 250);
  }
}
