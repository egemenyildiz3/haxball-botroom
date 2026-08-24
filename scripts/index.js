const fs = require('fs');
const path = require('path');
const { createHostRoom } = require('./bot/hostRoom');

const { getTimestamp, sanitizeStadiumFileContents, sleep } = require('./util');
const { loadOrCreateDatabase, persistDatabase, initRoomDatabase, initSharedDatabase } = require('./db');
const { createRoom } = require('./room');
const { createBotManager } = require('./bot/manager');
const config = require('./config');
const { createTranslator } = require('./i18n');
const { createLogger } = require('./logger');

const DEFAULT_TOKEN_FILE = '/run/haxball/spacebounce-v4-token.txt';
const logger = createLogger(config.logging);
logger.installConsole();

function resolveAppPath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(__dirname, '..', filePath);
}

const MAP_FILE = resolveAppPath(config.map.file);
const DB_FILE = resolveAppPath(config.database.file);
const SHARED_DB_FILE = resolveAppPath(config.sharedDatabase.file);

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
let roomDb = null;
let sharedDb = null;

if (!TOKEN) {
  console.error('HAXBALL_TOKEN bulunamadı.');
  console.error(`Lütfen HAXBALL_TOKEN env değişkenini veya HAXBALL_TOKEN_FILE dosyasını tanımlayın. Varsayılan dosya: ${DEFAULT_TOKEN_FILE}`);
  process.exit(1);
}

if (!fs.existsSync(MAP_FILE)) {
  console.error(`Map dosyası bulunamadı: ${MAP_FILE}`);
  console.error('ROOM_PROFILE / HAXBALL_MAP_FILE ayarını veya maps klasöründeki dosyayı kontrol edin.');
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
  console.log(`${getTimestamp()} Profile: ${config.profile} | Map: ${config.map.file} | Room DB: ${config.database.file} | Shared DB: ${config.sharedDatabase.file}`);

  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  roomDb = loadOrCreateDatabase(SQL, DB_FILE);
  sharedDb = loadOrCreateDatabase(SQL, SHARED_DB_FILE);
  initRoomDatabase(roomDb);
  initSharedDatabase(sharedDb);
  persistDatabase(roomDb, DB_FILE);
  persistDatabase(sharedDb, SHARED_DB_FILE);

  const botManager = createBotManager({
    botName: config.bot.baseName,
    brain: config.bot.brain,
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
    geo: config.room.geo,
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
    db: sharedDb,
    DB_FILE: SHARED_DB_FILE,
    sharedDb,
    SHARED_DB_FILE,
    roomDb,
    ROOM_DB_FILE: DB_FILE,
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
